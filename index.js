import puppeteer from 'puppeteer';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Xvfb from 'xvfb';
import { PassThrough, Writable } from 'stream';
import { spawn } from 'child_process';

// Increase the process listener limit. Puppeteer registers process-level
// exit/SIGINT/SIGTERM/SIGHUP listeners on every browser launch and does not
// always clean them up on close. This silences the noisy
// MaxListenersExceededWarning so real problems are easier to see in the logs.
process.setMaxListeners(50);

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname)
const VERSION = '2.4'; // version 2.4 - ffmpeg-side logging (segment watchdog, progress tracking, stderr capture); removed capture-side hang watchdog (proven unnecessary)
const ZIP_CODE = process.env.ZIP_CODE || '90210';
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost';
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = process.env.STREAM_PORT || '9798';
const WS4KP_SCANLINES = process.env.WS4KP_SCANLINES || false;
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}?scanLines=${WS4KP_SCANLINES}`;
const PERMALINK_URL = process.env.PERMALINK_URL || null;
const HLS_SETUP_DELAY = 2000;
const FRAME_RATE = process.env.FRAME_RATE || 25;
const HLS_SEGMENT_SECONDS = 2;

// Optional proactive browser refresh. If set to a number > 0, the browser
// will be relaunched on this interval (minutes) regardless of whether
// anything has gone wrong. 0 = disabled (default).
const BROWSER_REFRESH_MINUTES = parseInt(process.env.BROWSER_REFRESH_MINUTES || '0', 10);

// Segment freshness watchdog: HLS segments should land roughly every
// HLS_SEGMENT_SECONDS. If we go this long without any output file's mtime
// advancing, ffmpeg is stalled on the encode/write/mux side.
const SEGMENT_STALL_WARN_MS = 8000;
const SEGMENT_CHECK_INTERVAL_MS = 2000;
const STDERR_BUFFER_LINES = 40;

const OUTPUT_DIR = path.join(__dirname, 'output');
const AUDIO_DIR = path.join(__dirname, 'music');
const LOGO_DIR = path.join(__dirname, 'logo');
const HLS_FILE = path.join(OUTPUT_DIR, 'stream.m3u8');

// ws4kp 7.x supports 4 view modes: standard, wide, wide-enhanced, portrait-enhanced
// sort out the user's preferences and set up appropriate constants
const validViewModes = ['standard', 'wide', 'wide-enhanced', 'portrait-enhanced'];
// get the view mode (or default) and make it lower case
const desiredViewMode = (process.env.VIEW_MODE || 'wide').toLowerCase();
// test against the valid modes and set up the constant
const VIEW_MODE = validViewModes.includes(desiredViewMode) ? desiredViewMode : 'wide';

// set up the width and height constants via immediately invoked function
const VIEW_DIMENSIONS = (()=>{
	switch(VIEW_MODE) {
		case 'standard':
			return {
				width: 640,
				height: 480,
			}
		case 'portrait-enhanced':
			return {
				width: 720,
				height: 1280,
			}
		case 'wide':
		case 'wide-enhanced':
		default:
			return {
				width: 1280,
				height: 720,
			}
	}
})();

[OUTPUT_DIR, AUDIO_DIR, LOGO_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir); });

app.use('/stream', express.static(OUTPUT_DIR));
app.use('/logo', express.static(LOGO_DIR));

let ffmpegProc = null;
let ffmpegStream = null;
let browser = null;
let page = null;
let captureProcess = null;
let captureInterval = null;
let refreshTimer = null;
let segmentWatchdogInterval = null;
let isStreamReady = false;
let xvfb = null;

// --- State for backpressure + overlap protection + restart diagnostics ---
let isCapturing = false;         // prevents overlapping capture calls
let isRestartingBrowser = false; // prevents overlapping/concurrent browser launches
let canWrite = true;             // false when ffmpegStream's internal buffer is full
let browserRestartCount = 0;     // how many times we've had to relaunch the browser
let framesWritten = 0;
let framesSkippedBackpressure = 0;
let framesSkippedOverlap = 0;
let framesSkippedRestarting = 0;

// --- Screenshot timing (kept — cheap, and useful as a "capture side is
// healthy" baseline now that we've ruled it out as the freeze cause) ---
let totalScreenshotMs = 0;
let maxScreenshotMs = 0;
let captureStartedAt = null; // timestamp of the currently in-flight Capture, or null

// --- ffmpeg-side instrumentation (new) ---
let stderrBuffer = [];              // rolling buffer of the last N ffmpeg stderr lines
let lastProgress = null;            // most recent fluent-ffmpeg 'progress' payload
let lastProgressAt = null;          // when we last received a progress event
let lastSegmentMtimeMs = null;      // newest mtime seen among output files
let lastSegmentChangeAt = null;     // wall-clock time that mtime last advanced
let segmentStallActive = false;     // whether we're currently in a detected stall
let segmentStallWarningsIssued = 0; // how many distinct stall episodes we've logged
let lastStallDumpAt = 0;            // throttles repeated stderr dumps during one long stall

const waitFor = ms => new Promise(resolve => setTimeout(resolve, ms));

function logTS(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Helper: Fisher–Yates shuffle
function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getContainerLimits() {
  let cpuQuotaPath = '/sys/fs/cgroup/cpu.max';
  let memLimitPath = '/sys/fs/cgroup/memory.max';
  let cpus = os.cpus().length;
  let memory = os.totalmem();
  try { const [quota, period] = fs.readFileSync(cpuQuotaPath,'utf8').trim().split(' '); if(quota!=='max') cpus=parseFloat((parseInt(quota)/parseInt(period)).toFixed(2)); } catch {}
  try { const raw = fs.readFileSync(memLimitPath,'utf8').trim(); if(raw!=='max') memory=parseInt(raw); } catch {}
  return { cpus, memoryMB: Math.round(memory/(1024*1024)) };
}

function createAudioInputFile() {
  const defaultMp3s = [
    '01 Weatherscan Track 26.mp3','02 Weatherscan Track 3.mp3','03 Tropical Breeze.mp3',
    '04 Late Nite Cafe.mp3','05 Care Free.mp3','06 Weatherscan Track 14.mp3','07 Weatherscan Track 18.mp3'
  ];

  let files = [];
  try {
    // Read only MP3 files from AUDIO_DIR
    files = fs.readdirSync(AUDIO_DIR).filter(file => file.toLowerCase().endsWith('.mp3'));
    if (files.length === 0) {
      console.warn('No MP3 files found in music directory; using default music list');
      files = defaultMp3s;
    }
  } catch (err) {
    console.error(`Failed to read music directory: ${err.message}`);
    console.warn('Using default music list due to error');
    files = defaultMp3s;
  }
  
  // Shuffle if requested
  if (process.env.SHUFFLE_MUSIC?.toLowerCase() === 'true') {
    files = shuffleArray(files);
    console.log('Shuffled music list based on SHUFFLE_MUSIC=true');
  }

  console.log(`Loaded ${files.length} music files`);
  const audioList = files.map(file => `file '${path.join(AUDIO_DIR, file)}'`).join('\n');
  fs.writeFileSync(path.join(__dirname, 'audio_list.txt'), audioList);


  // Note: Update README to inform users they can add MP3 files to the 'music' folder
  // and that the default files (listed above) are used if no MP3s are found.
}

function generateXMLTV(host) {
  const now = new Date();
  const baseUrl = `http://${host}`;
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv>
<channel id="WS4000">
<display-name>WeatherStar 4000</display-name>
<icon src="${baseUrl}/logo/ws4000.png" />
</channel>`;
  for(let i=0;i<24;i++){
    const startTime = new Date(now.getTime()+i*3600*1000);
    const endTime = new Date(startTime.getTime()+3600*1000);
    const start = startTime.toISOString().replace(/[-:T]/g,'').split('.')[0]+' +0000';
    const end = endTime.toISOString().replace(/[-:T]/g,'').split('.')[0]+' +0000';
    xml += `
<programme start="${start}" stop="${end}" channel="WS4000">
<title lang="en">Local Weather</title>
<desc lang="en">Enjoy your local weather with a touch of nostalgia.</desc>
<icon src="${baseUrl}/logo/ws4000.png" />
</programme>`;
  }
  xml += `</tv>`;
  return xml;
}

async function startBrowser(reason = 'initial startup') {
  // Hard lock: only one browser launch can be in progress at a time.
  if (isRestartingBrowser) {
    logTS('startBrowser() called while a restart was already in progress — ignoring duplicate call');
    return;
  }
  isRestartingBrowser = true;

  try {
    browserRestartCount++;
    logTS(`Launching browser (launch #${browserRestartCount}, reason: ${reason})`);
    if(browser) await browser.close().catch(()=>{});
    if(xvfb) await xvfb.stop();
    xvfb = new Xvfb ({
        silent: true,
        xvfb_args: ["-screen", "0", `${VIEW_DIMENSIONS.width}x${VIEW_DIMENSIONS.height}x24`,  "-ac"],
    });
    xvfb.startSync((err)=>{if (err) console.error(err)})
    logTS(`XVFB launched`);
    browser = await puppeteer.launch({
      headless: false,
      args:[
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--ignore-certificate-errors',
        '--window-size='+VIEW_DIMENSIONS.width+','+VIEW_DIMENSIONS.height,
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--display='+xvfb._display
      ],
      defaultViewport: null
    });
    page = await browser.newPage();
    if (PERMALINK_URL) {
      console.log(`Using custom permalink URL: ${PERMALINK_URL}`);
      await page.goto(PERMALINK_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    } else {
      await page.goto(WS4KP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      try {
        const zipInput = await page.waitForSelector('input[placeholder="Zip or City, State"], input', { timeout: 5000 });
        if (zipInput) {
          // type the zip code
          await zipInput.type(ZIP_CODE, { delay: 100 });
          // wit for suggestions box
          await page.waitForSelector('#divQuery .autocomplete-suggestions .suggestion');
          // select the first suggestion
          await page.keyboard.press('ArrowDown');
          // wait for the selection to be highlighted
          await page.waitForSelector('#divQuery .autocomplete-suggestions .suggestion.selected');
          // find and press the submit button
          const goButton = await page.$('button[type="submit"]');
          if (goButton) await goButton.click(); else await zipInput.press('Enter');
          // wait for weather content to update
          await page.waitForSelector('div.weather-display, #weather-content', { timeout: 30000 });
        }
      } catch {}

      // force ws4kp app to wide screen and kiosk (full screen), this removes the need to specify exactly where to crop for the screenshot

      try {
        // get the widescreen checkbox from the settings section
        // will throw if the element is not present on ws4kp 7.x and a different path is taken in the catch statement
        // which is the reason for the short timeout
        const widescreenCheckbox = await page.waitForSelector('#settings-wide-checkbox', {timeout: 100});


        // 6.x (classic) behavior
        // only supports standard and wide, check and exit with an error if not doable
        if (VIEW_MODE === 'wide-enhanced' || VIEW_MODE === 'portrait-enhanced') {
          console.error(`This version of ws4kp only supports VIEW_MODE 'standard' or 'enhanced'`);
          await browser.close();
          await xvfb.stop();
          process.exit();
        }
        // get the checkbox's current state and click it to turn it on if necessary
        const widescreenChecked = await widescreenCheckbox.evaluate((el) => el.checked);
        // click the checkbox on a mismatch
        if (widescreenChecked && VIEW_MODE === 'standard' || !widescreenChecked && VIEW_MODE === 'wide') await widescreenCheckbox.click();
      } catch {
              try {
              // 7.x (wide/portrait/enhanced behavior)
              // get the selector box and select widescreen
              const viewSelector = await page.waitForSelector('#settings-viewMode-select');
              // set the desired mode
              await viewSelector.evaluate((el, VIEW_MODE) => {
                el.value = VIEW_MODE;
                el.dispatchEvent(new Event('change'));
              }, VIEW_MODE);
            } catch {}

      }
      finally {
        // both 6.x and 7.x support kiosk as a checkbox
        // and now for kiosk
        const kioskCheckbox = await page.waitForSelector('#settings-kiosk-checkbox');    // set the checkbox
        const kioskChecked = await kioskCheckbox.evaluate((el) => el.checked);
        if (!kioskChecked) await kioskCheckbox.click();
      }
    }
    await page.setViewport({ ...VIEW_DIMENSIONS });

    // Reset capture guards after a fresh browser/page is ready.
    isCapturing = false;
    canWrite = true;
    captureStartedAt = null;
    logTS(`Browser ready (launch #${browserRestartCount})`);
  } finally {
    isRestartingBrowser = false;
  }
}

function scheduleBrowserRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (!BROWSER_REFRESH_MINUTES || BROWSER_REFRESH_MINUTES <= 0) {
    logTS('Scheduled browser refresh disabled (BROWSER_REFRESH_MINUTES not set)');
    return;
  }
  logTS(`Scheduled browser refresh enabled: every ${BROWSER_REFRESH_MINUTES} minute(s)`);
  refreshTimer = setInterval(() => {
    startBrowser(`scheduled refresh (${BROWSER_REFRESH_MINUTES}m interval)`);
  }, BROWSER_REFRESH_MINUTES * 60 * 1000);
}

function dumpFfmpegDiagnostics(gapMs) {
  logTS(`FFMPEG STALL WARNING: no new HLS segment/file activity in ${gapMs}ms (segments should land roughly every ${HLS_SEGMENT_SECONDS * 1000}ms)`);

  if (lastProgress) {
    const sinceProgress = lastProgressAt ? (Date.now() - lastProgressAt) : null;
    logTS(`Last ffmpeg progress event (${sinceProgress}ms ago): frames=${lastProgress.frames}, currentFps=${lastProgress.currentFps}, currentKbps=${lastProgress.currentKbps}, timemark=${lastProgress.timemark}`);
  } else {
    logTS('No ffmpeg progress events received yet this session');
  }

  if (stderrBuffer.length === 0) {
    logTS('(no ffmpeg stderr output captured yet)');
  } else {
    logTS(`Last ${stderrBuffer.length} ffmpeg stderr line(s):`);
    stderrBuffer.forEach(line => console.log(`  ffmpeg: ${line}`));
  }
}

function startSegmentWatchdog() {
  if (segmentWatchdogInterval) clearInterval(segmentWatchdogInterval);
  lastSegmentMtimeMs = null;
  lastSegmentChangeAt = Date.now();
  segmentStallActive = false;

  segmentWatchdogInterval = setInterval(() => {
    let files;
    try {
      files = fs.readdirSync(OUTPUT_DIR);
    } catch {
      return; // output dir momentarily unavailable, e.g. during a restart
    }

    let newestMtime = 0;
    for (const f of files) {
      if (!f.endsWith('.ts') && !f.endsWith('.m3u8')) continue;
      try {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        if (stat.mtimeMs > newestMtime) newestMtime = stat.mtimeMs;
      } catch {}
    }

    if (newestMtime > 0 && (lastSegmentMtimeMs === null || newestMtime > lastSegmentMtimeMs)) {
      lastSegmentMtimeMs = newestMtime;
      lastSegmentChangeAt = Date.now();
      if (segmentStallActive) {
        logTS('FFMPEG STALL RECOVERED: new segment activity detected, output is flowing again');
        segmentStallActive = false;
      }
      return;
    }

    const gapMs = Date.now() - lastSegmentChangeAt;
    if (gapMs > SEGMENT_STALL_WARN_MS) {
      // Log the initial detection immediately, then only re-dump every 5s
      // while the same stall continues, so a long stall doesn't spam the log.
      if (!segmentStallActive || Date.now() - lastStallDumpAt > 5000) {
        segmentStallActive = true;
        lastStallDumpAt = Date.now();
        segmentStallWarningsIssued++;
        dumpFfmpegDiagnostics(gapMs);
      }
    }
  }, SEGMENT_CHECK_INTERVAL_MS);
}

async function startTranscoding() {
  await startBrowser('initial startup');
  createAudioInputFile();
  scheduleBrowserRefresh();

  // Give the PassThrough a modest, explicit buffer size. This is what makes
  // backpressure kick in quickly rather than silently buffering an
  // ever-growing backlog of frames in memory.
  ffmpegStream = new PassThrough({ highWaterMark: 1024 * 1024 * 4 }); // ~4MB
  ffmpegStream.on('drain', () => {
    canWrite = true;
  });

  stderrBuffer = [];
  lastProgress = null;
  lastProgressAt = null;

  ffmpegProc = ffmpeg()
    .input(ffmpegStream)
    .inputOptions([`-framerate ${FRAME_RATE}`])
    .input(path.join(__dirname,'audio_list.txt'))
    .inputOptions([
	'-f concat',
	'-safe 0',
	'-stream_loop -1'
    ])
    .complexFilter([
        `[0:v]scale=${VIEW_DIMENSIONS.width}:${VIEW_DIMENSIONS.height}[v]`,
        '[1:a]aresample=48000,volume=0.5[a]'
    ])
    .outputOptions([
	'-map [v]',
	'-map [a]',
	'-c:v libx264',
	'-preset fast',
	'-c:a aac',
	'-b:a 128k',
	'-rc_mode 2',
	`-g ${FRAME_RATE * HLS_SEGMENT_SECONDS}`,
	'-b:v 1500k',
	'-f hls',
	`-hls_time ${HLS_SEGMENT_SECONDS}`,
	'-hls_list_size 6',
	'-hls_flags delete_segments'
    ])
	.output(HLS_FILE)
    .on('start',(cmd)=>{
		logTS(`Started FFmpeg - Version ${VERSION}`);
		logTS(`FFmpeg command: ${cmd}`);
		setTimeout(()=>isStreamReady=true,HLS_SETUP_DELAY);
	})
    .on('stderr', line => {
      stderrBuffer.push(line);
      if (stderrBuffer.length > STDERR_BUFFER_LINES) stderrBuffer.shift();
    })
    .on('progress', p => {
      lastProgress = p;
      lastProgressAt = Date.now();
    })
    .on('error', async err=>{ logTS(`FFmpeg error: ${err.message}`); await stopTranscoding(); startTranscoding(); })
    .on('end',()=>{ ffmpegProc=null; ffmpegStream=null; isStreamReady=false; });

  startSegmentWatchdog();

  captureInterval = setInterval(async ()=>{
    if(!ffmpegProc || !ffmpegStream || !page) return;

    // A browser relaunch is already in progress — don't touch the page or
    // trigger another one.
    if (isRestartingBrowser) {
      framesSkippedRestarting++;
      return;
    }

    // Don't start a new screenshot if the previous one hasn't finished yet.
    if (isCapturing) {
      framesSkippedOverlap++;
      return;
    }

    // Don't capture new frames if ffmpeg can't keep up.
    if (!canWrite) {
      framesSkippedBackpressure++;
      return;
    }

    isCapturing = true;
    captureStartedAt = Date.now();
    try{
      if(page.isClosed()){ isCapturing = false; captureStartedAt = null; await startBrowser('page was closed'); return; }
      // Updated 16:9 capture for version 1.6
      const screenshot = await page.screenshot({
        type:'png',
        optimizeForSpeed:true
      });

      const elapsedMs = Date.now() - captureStartedAt;
      totalScreenshotMs += elapsedMs;
      if (elapsedMs > maxScreenshotMs) maxScreenshotMs = elapsedMs;

      const ok = ffmpegStream.write(screenshot);
      framesWritten++;
      if (!ok) canWrite = false; // wait for 'drain' before writing again

      // Every 5 minutes, log a quick health summary.
      if (framesWritten % (FRAME_RATE * 60 * 5) === 0) {
        const avgMs = Math.round(totalScreenshotMs / framesWritten);
        const sinceProgress = lastProgressAt ? (Date.now() - lastProgressAt) : null;
        logTS(`Health check: framesWritten=${framesWritten}, avgScreenshotMs=${avgMs}, maxScreenshotMs=${maxScreenshotMs}, skippedBackpressure=${framesSkippedBackpressure}, skippedOverlap=${framesSkippedOverlap}, skippedRestarting=${framesSkippedRestarting}, browserRestarts=${browserRestartCount}, segmentStallWarnings=${segmentStallWarningsIssued}, msSinceLastFfmpegProgress=${sinceProgress}`);
      }
    } catch(err){
      console.warn('Capture error, retrying...', err.message);
      isCapturing = false;
      captureStartedAt = null;
      await startBrowser(`capture error: ${err.message}`);
      return;
    }
    isCapturing = false;
    captureStartedAt = null;
  },1000/FRAME_RATE);

  ffmpegProc.run();
}

async function stopTranscoding(){
  if(captureInterval) clearInterval(captureInterval);
  captureInterval=null; isStreamReady=false;
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer=null;
  if(segmentWatchdogInterval) clearInterval(segmentWatchdogInterval);
  segmentWatchdogInterval=null;
  if(ffmpegProc) ffmpegProc.kill('SIGINT'); ffmpegProc=null;
  if(browser) await browser.close().catch(()=>{}); browser=null;
}

app.get('/playlist.m3u',(req,res)=>{
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  const baseUrl = `http://${host}`;
  const m3uContent = `#EXTM3U
#EXTINF:-1 channel-id="weatherStar4000" tvg-id="weatherStar4000" tvg-channel-no="275" tvc-guide-placeholders="3600" tvc-guide-title="Local Weather" tvc-guide-description="Enjoy your local weather with a touch of nostalgia." tvc-guide-art="${baseUrl}/logo/ws4000.png" tvg-logo="${baseUrl}/logo/ws4000.png",WeatherStar 4000
${baseUrl}/stream/stream.m3u8
`;
  res.set('Content-Type','application/x-mpegURL'); res.send(m3uContent);
});

app.get('/guide.xml',(req,res)=>{
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  res.set('Content-Type','application/xml'); res.send(generateXMLTV(host));
});

app.get('/health',(req,res)=>{
  const avgScreenshotMs = framesWritten > 0 ? Math.round(totalScreenshotMs / framesWritten) : 0;
  const currentlyStuckMs = (isCapturing && captureStartedAt) ? (Date.now() - captureStartedAt) : 0;
  const msSinceLastSegmentChange = lastSegmentChangeAt ? (Date.now() - lastSegmentChangeAt) : null;
  const msSinceLastFfmpegProgress = lastProgressAt ? (Date.now() - lastProgressAt) : null;

  res.status(isStreamReady?200:503).json({
    ready:isStreamReady,
    browserRestarts: browserRestartCount,
    framesWritten,
    framesSkippedBackpressure,
    framesSkippedOverlap,
    framesSkippedRestarting,
    avgScreenshotMs,
    maxScreenshotMs,
    currentlyStuckMs,
    segmentStallWarningsIssued,
    segmentStallActive,
    msSinceLastSegmentChange,
    msSinceLastFfmpegProgress,
    lastFfmpegTimemark: lastProgress ? lastProgress.timemark : null
  });
});

const { cpus, memoryMB } = getContainerLimits();
console.log(`Version ${VERSION} | Running with ${cpus} CPU cores, ${memoryMB}MB RAM`);

app.listen(STREAM_PORT, async ()=>{
  console.log(`Streaming server running on port ${STREAM_PORT}`);
  await startTranscoding();
});

process.on('SIGINT', async ()=>{ console.log('SIGINT received'); await stopTranscoding(); process.exit(); });
process.on('SIGTERM', async ()=>{ console.log('SIGTERM received'); await stopTranscoding(); process.exit(); });
