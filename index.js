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
const VERSION = 'vAPP_VERSION';
const ZIP_CODE = process.env.ZIP_CODE || '90210';
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost';
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = process.env.STREAM_PORT || '9798';
const WS4KP_FORECAST_CD = process.env.WS4KP_FORECAST_CD || '1.0';
const WS4KP_SCANLINES = process.env.WS4KP_SCANLINES.toLowerCase() === 'true' || false;
const WS4KP_CURRENT_WEATHER = process.env.WS4KP_CURRENT_WEATHER.toLowerCase() === 'true' || true;
const WS4KP_LATEST_OBSERVATIONS = process.env.WS4KP_LATEST_OBSERVATIONS.toLowerCase() === 'true' || true;
const WS4KP_HOURLY = process.env.WS4KP_HOURLY.toLowerCase() === 'true' || true;
const WS4KP_HOURLY_GRAPH = process.env.WS4KP_HOURLY_GRAPH.toLowerCase() === 'true' || false;
const WS4KP_TRAVEL = process.env.WS4KP_TRAVEL.toLowerCase() === 'true' || false;
const WS4KP_REGIONAL_FORECAST = process.env.WS4KP_REGIONAL_FORECAST || true;
const WS4KP_LOCAL_FORECAST = process.env.WS4KP_LOCAL_FORECAST.toLowerCase() === 'true' || true;
const WS4KP_EXTENDED_FORECAST = process.env.WS4KP_EXTENDED_FORECAST.toLowerCase() === 'true' || true;
const WS4KP_ALMANAC = process.env.WS4KP_ALMANAC.toLowerCase() === 'true' || false;
const WS4KP_RADAR = process.env.WS4KP_RADAR.toLowerCase() === 'true' || true;
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}?radar=${WS4KP_RADAR}&almanac=${WS4KP_ALMANAC}&extended-forecast=${WS4KP_EXTENDED_FORECAST}&local-forecast=${WS4KP_LOCAL_FORECAST}&regional-forecast=${WS4KP_REGIONAL_FORECAST}&travel=${WS4KP_TRAVEL}&hourly-graph=${WS4KP_HOURLY_GRAPH}&hourly=${WS4KP_HOURLY}&latest-observations=${WS4KP_LATEST_OBSERVATIONS}&current-weather=${WS4KP_CURRENT_WEATHER}&scanLines=${WS4KP_SCANLINES}&speed=${WS4KP_FORECAST_CD}&spc-outlook=false`;
const PERMALINK_URL = process.env.PERMALINK_URL || null;
const HLS_SETUP_DELAY = 2000;
const KBPS_BITRATE = process.env.KBPS_BITRATE || '1000';
const FRAME_RATE = Number(process.env.FRAME_RATE) || 15;
const SHUFFLE_MUSIC = process.env.SHUFFLE_MUSIC.toLowerCase() === 'true' || false;
const SHOW_SONG_TITLE = process.env.SHOW_SONG_TITLE?.toLowerCase() === 'true' || false;
const HLS_SEGMENT_SECONDS = 2;
const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

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

// Song title polling interval (ms)
const SONG_TITLE_POLL_INTERVAL_MS = 1000;

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
let browser = null;
let page = null;
let captureProcess = null;
let captureInterval = null;
let refreshTimer = null;
let segmentWatchdogInterval = null;
let songTitlePollingInterval = null;
let isStreamReady = false;
let xvfb = null;
let lastLoggedTime = null;
let songNowPlaying = 'Starting stream...';
let songWasPlaying = 'Starting stream...';

// --- State for backpressure + overlap protection + restart diagnostics ---
let isCapturing = false;         // prevents overlapping capture calls
let isRestartingBrowser = false; // prevents overlapping/concurrent browser launches
let browserRestartCount = 0;     // how many times we've had to relaunch the browser
let framesSkippedRestarting = 0;

// --- Frame timing ---
let totalFrameTimeMs = 0;
let maxFrameTimeMs = 0;
let avgFrameTimeMs = 0;
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
  if (SHUFFLE_MUSIC) {
    files = shuffleArray(files);
    logTS('Shuffled music list based on SHUFFLE_MUSIC=true');
  }

  logTS(`Loaded ${files.length} music files`);
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

/**
 * Polls for song title changes and updates the custom text crawl in WS4KP.
 * Runs at SONG_TITLE_POLL_INTERVAL_MS and updates only when the title changes.
 */
async function startSongTitlePolling() {
  if (songTitlePollingInterval) clearInterval(songTitlePollingInterval);
  if (!SHOW_SONG_TITLE || !page || page.isClosed()) {
    return;
  }

  logTS('Starting song title polling');
  songTitlePollingInterval = setInterval(async () => {
    if (!page || page.isClosed()) {
      logTS('Page closed, stopping song title polling');
      if (songTitlePollingInterval) clearInterval(songTitlePollingInterval);
      songTitlePollingInterval = null;
      return;
    }

    try {
      // Only update if the title has changed
      if (songNowPlaying !== songWasPlaying) {
        logTS(`Song changed: "${songWasPlaying}" → "${songNowPlaying}"`);
        // Update the custom text input and enable/set it
        try {
          // Use evaluate to interact with the DOM directly.
          // This bypasss all "Node is not clickable" and "Overlay" errors.
          await page.evaluate((songName) => {
            const checkbox = document.querySelector('#settings-customTextEnable-checkbox');
            const textInput = document.querySelector('#settings-customText-string');
            const setButton = document.querySelector('#settings-customText-button');

            if (checkbox) {
              // Force the checkbox to be checked via JS
              checkbox.checked = true;
              // Trigger events so the simulator's internal logic knows it changed
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (textInput) {
              // Set the value directly
              textInput.value = 'Now Playing: ' + songName;
              textInput.dispatchEvent(new Event('input', { bubbles: true }));
              textInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (setButton) {
              // Click the button via JS (ignores overlays)
              setButton.click();
            }
          }, songNowPlaying);

          logTS(`Successfully updated text to: "Now Playing: ${songNowPlaying}"`);
          songWasPlaying = songNowPlaying; // ONLY update success state here

        } catch (err) {
          logTS(`Failed to update custom text: ${err.message}`);
        }
      }
    } catch (err) {
      // Silently catch errors during polling to avoid spam; log only serious issues
      if (!err.message.includes('Target page, context or browser has been closed')) {
        logTS(`Song title polling error: ${err.message}`);
      }
    }
  }, SONG_TITLE_POLL_INTERVAL_MS);
}

/**
 * Stops the song title polling interval.
 */
function stopSongTitlePolling() {
  if (songTitlePollingInterval) {
    clearInterval(songTitlePollingInterval);
    songTitlePollingInterval = null;
    logTS('Song title polling stopped');
  }
}

async function startBrowser(reason = 'initial startup') {
  // Hard lock: only one browser launch can be in progress at a time.
  if (isRestartingBrowser) {
    logTS('startBrowser() called while a restart was already in progress — ignoring duplicate call');
    return;
  }
  isRestartingBrowser = true;

  try {
    // Stop song title polling before browser restart
    stopSongTitlePolling();

    browserRestartCount++;
    if(xvfb) await xvfb.stop();
    xvfb = await new Xvfb ({
      silent: false,
      reuse: false,
      xvfb_args: ["-screen", "0", `${VIEW_DIMENSIONS.width}x${VIEW_DIMENSIONS.height}x24 -ac`],
    });
    await xvfb.start((err)=>{if (err) console.error(err)});
    process.env['DISPLAY'] = xvfb._display;
    logTS(`Xvfb launched with display: ${process.env.DISPLAY}`);
    await sleep(3000);

    logTS(`Launching browser on ${xvfb._display} (launch #${browserRestartCount}, reason: ${reason})`);
    if(browser) await browser.close().catch(()=>{});
    browser = await puppeteer.launch({
      headless: false,
      args:[
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--ignore-certificate-errors',
        '--window-size='+VIEW_DIMENSIONS.width+','+VIEW_DIMENSIONS.height,
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--start-fullscreen',
        '--autoplay-policy=no-user-gesture-required',
        `--display=${xvfb._display}`
      ],
      defaultViewport: null
    });
    page = await browser.newPage();
    if (PERMALINK_URL) {
      logTS(`Using custom permalink URL: ${PERMALINK_URL}`);
      await page.goto(PERMALINK_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    } else {
      logTS(`Using URL: ${WS4KP_URL}`);
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

      // force ws4kp app to wide screen and kiosk (full screen), this removes the need to crop

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
    captureStartedAt = null;
    
    // Start song title polling if enabled
    if (SHOW_SONG_TITLE) {
      await startSongTitlePolling();
    }
    
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
  refreshTimer = setInterval(async () => {
    try {
      logTS('Restarting transcoding after scheduled browser refresh');

      await stopTranscoding();
      await startTranscoding();
    } catch (err) {
      console.error(`Scheduled refresh failed: ${err.message}`);
    }
  }, BROWSER_REFRESH_MINUTES * 60 * 1000);
}

function dumpFfmpegDiagnostics(gapMs) {
  logTS(`FFMPEG STALL WARNING: no new HLS segment/file activity in ${gapMs}ms (segments should land roughly every ${HLS_SEGMENT_SECONDS * 1000}ms)`);

  if (lastProgress) {
    const sinceProgress = lastProgressAt ? (Date.now() - lastProgressAt) : null;
    const frameCount = lastProgress ? lastProgress.frames : 0;
    const avgFrameTimeMs = frames > 0 ? Math.round(totalFrameTimeMs / frameCount) : 0;
    const currentFps = lastProgress ? lastProgress.currentFps : 0;
    const currentKbps = lastProgress ? lastProgress.currentKbps : 0;
    const lastFfmpegTimemark = lastProgress ? lastProgress.timemark : 0;
    logTS(`Last ffmpeg progress event (${sinceProgress}ms ago): frames=${frameCount}, currentFps=${currentFps}, currentKbps=${currentKbps}, timemark=${lastFfmpegTimemark}`);
  } else {
    logTS('No ffmpeg progress events received yet this session');
  }

  if (stderrBuffer.length === 0) {
    logTS('(no ffmpeg stderr output captured yet)');
  } else {
    logTS(`Last ${stderrBuffer.length} ffmpeg stderr line(s):`);
    stderrBuffer.forEach(line => logTS(`  ffmpeg: ${line}`));
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

  stderrBuffer = [];
  lastProgress = null;
  lastProgressAt = null;

  ffmpegProc = ffmpeg()
    .input(xvfb._display + '.0')
    .inputOptions([
      '-f x11grab',
      `-framerate ${FRAME_RATE}`
    ])
    .input(path.join(__dirname, 'audio_list.txt'))
    .inputOptions([
      '-f concat',
      '-safe 0',
      '-stream_loop -1',
      '-loglevel debug'
    ])
    .complexFilter([
      `[0:v]scale=${VIEW_DIMENSIONS.width}:${VIEW_DIMENSIONS.height}[v]`,
      '[1:a]aresample=48000,volume=0.5[a]'
    ])
    .outputOptions([
      '-map [v]',
      '-map [a]',
      '-c:v libx264',
      '-preset veryfast',
      '-c:a aac',
      '-b:a 128k',
      '-rc_mode 2',
      `-g ${FRAME_RATE * HLS_SEGMENT_SECONDS}`,
      `-b:v ${KBPS_BITRATE}k`,
      '-f hls',
      `-hls_time ${HLS_SEGMENT_SECONDS}`,
      '-hls_list_size 6',
      '-hls_flags delete_segments'
    ])
    .output(HLS_FILE)
    .on('start',(cmd)=>{
      logTS(`Started FFmpeg`);
      logTS(`FFmpeg command: ${cmd}`);
      setTimeout(()=>{
        isStreamReady = true;
        isCapturing = true;
        captureStartedAt = Date.now();
      },HLS_SETUP_DELAY);
    })
    .on('stderr', line => {
      // Parse the line for the "Opening" event
      // FFmpeg logs: [concat @ 0x...] Opening '/app/music/Song.mp3'
      const songMatch = line.match(/Opening '(.+?)'/);

      if (songMatch && songMatch[1].endsWith('.mp3')) {
        const fullPath = songMatch[1];
        // Store the full path or just the filename
        songNowPlaying = path.basename(fullPath,'.mp3');
        logTS(`🎵: ${songNowPlaying}`);
      }
    })
    .on('progress', p => {
      lastProgress = p;
      lastProgressAt = Date.now();

      // Find interval values - only measure totalFrameTimeMs if we have a valid start time
      totalFrameTimeMs =  captureStartedAt? Date.now() - captureStartedAt : null;
      const frameCount = lastProgress ? lastProgress.frames : 0;
      avgFrameTimeMs = frameCount > 0 ? Math.round(totalFrameTimeMs / frameCount) : null;
      const lastFfmpegTimemark = lastProgress ? lastProgress.timemark : null;
      if (avgFrameTimeMs > maxFrameTimeMs) maxFrameTimeMs = avgFrameTimeMs;

      // Every minute (60000ms), log a quick health summary.
      //  We go by seconds because ffmpeg.on('progress') reports unevenly every 30ms or so.
      //  Then, we use lastLoggedTime so we don't duplicate logs.'
      let elapsedSeconds = Math.floor(totalFrameTimeMs/1000);
      if (((elapsedSeconds % 60) === 0) && (lastLoggedTime != elapsedSeconds)) {
        lastLoggedTime = elapsedSeconds;
        const sinceProgress = lastProgressAt ? (Date.now() - lastProgressAt) : null;
        logTS(`Health check: captureStartedAt=${captureStartedAt}, totalFrameTimeMs=${totalFrameTimeMs}, frames=${frameCount}, avgFrameTimeMs=${avgFrameTimeMs}, maxFrameTimeMs=${maxFrameTimeMs}, skippedRestarting=${framesSkippedRestarting}, browserRestarts=${browserRestartCount}, segmentStallWarnings=${segmentStallWarningsIssued}, msSinceLastFfmpegProgress=${sinceProgress}`);
      }
    })
    .on('error', async err=>{
      logTS(`FFmpeg error: ${err.message}`);
      await stopTranscoding();
      startTranscoding();
    })
    .on('end',()=>{
      ffmpegProc = null;
      isStreamReady = false;
      isCapturing = false;
      captureStartedAt = null;
    });

  startSegmentWatchdog();

  captureInterval = setInterval(async ()=>{
    if(!ffmpegProc || !page) return;

    // A browser relaunch is already in progress — don't touch the page or
    // trigger another one.
    if (isRestartingBrowser) {
      framesSkippedRestarting++;
      return;
    }

    try{
      if(page.isClosed()){
        isCapturing = false;
        captureStartedAt = null;
        await startBrowser('page was closed');
        return;
      }
    } catch(err){
      console.warn('Capture error, retrying...', err.message);
      await startBrowser(`capture error: ${err.message}`);
      return;
    }
  },1000/FRAME_RATE); // Only run this once per expected frame duration in milliseconds

  ffmpegProc.run();
}

async function stopTranscoding(){
  stopSongTitlePolling();
  if(captureInterval) clearInterval(captureInterval);
  captureInterval=null; isStreamReady=false;
  if(refreshTimer) clearInterval(refreshTimer); refreshTimer=null;
  if(segmentWatchdogInterval) clearInterval(segmentWatchdogInterval); segmentWatchdogInterval=null;
  if(ffmpegProc) ffmpegProc.kill('SIGINT'); ffmpegProc=null;
  if(browser) await browser.close().catch(()=>{}); browser=null;
  if(xvfb) await xvfb.stop(); xvfb=null;
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
  const frames = lastProgress ? lastProgress.frames : null;
  const currentFps = lastProgress ? lastProgress.currentFps : null;
  const lastFfmpegTimemark = lastProgress ? lastProgress.timemark : null;
  const msSinceLastSegmentChange = lastSegmentChangeAt ? (Date.now() - lastSegmentChangeAt) : null;
  const msSinceLastFfmpegProgress = lastProgressAt ? (Date.now() - lastProgressAt) : null;

  res.status(isStreamReady?200:503).json({
    ready:isStreamReady,
    lastFfmpegTimemark,
    currentFps,
    totalFrameTimeMs,
    frames,
    avgFrameTimeMs,
    maxFrameTimeMs,
    msSinceLastSegmentChange,
    msSinceLastFfmpegProgress,
    segmentStallActive,
    segmentStallWarningsIssued,
    browserRestartCount,
    framesSkippedRestarting
  });
});

const { cpus, memoryMB } = getContainerLimits();
logTS(`ws4channels ${VERSION} running with ${cpus} CPU cores, ${memoryMB}MB RAM`);

app.listen(STREAM_PORT, async ()=>{
  logTS(`Streaming server running on port ${STREAM_PORT}`);
  await startTranscoding();
});

process.on('SIGINT', async ()=>{ logTS('SIGINT received'); await stopTranscoding(); process.exit(); });
process.on('SIGTERM', async ()=>{ logTS('SIGTERM received'); await stopTranscoding(); process.exit(); });
