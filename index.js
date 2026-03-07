const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const os = require('os');

const app = express();

// options
const WS4KP_HAZARDS = process.env.WS4KP_HAZARDS || true; // ?hazards-checkbox=true
const WS4KP_LATEST = process.env.WS4KP_LATEST || true; // &latest-observations-checkbox=true
const WS4KP_HOURLY = process.env.WS4KP_HOURLY || false; // &hourly-checkbox=false
const WS4KP_HOURLYGRAPH = process.env.WS4KP_HOURLYGRAPH || true; // &hourly-graph-checkbox=true
const WS4KP_TRAVEL = process.env.WS4KP_TRAVEL || false; // &travel-checkbox=false
const WS4KP_REGIONAL = process.env.WS4KP_REGIONAL || true; // &regional-forecast-checkbox=true
const WS4KP_LOCAL = process.env.WS4KP_LOCAL || true; // &local-forecast-checkbox=true
const WS4KP_EXTENDED = process.env.WS4KP_EXTENDED || true; // &extended-forecast-checkbox=true
const WS4KP_ALMANAC = process.env.WS4KP_ALMANAC || true; // &almanac-checkbox=true
const WS4KP_SPC = process.env.WS4KP_SPC || true; // &spc-outlook-checkbox=true
const WS4KP_RADAR = process.env.WS4KP_RADAR || true; // &radar-checkbox=true
const WS4KP_WIDE = process.env.WS4KP_WIDE || false; // &settings-wide-checkbox=false
const WS4KP_KIOSK = process.env.WS4KP_KIOSK || false; // &settings-kiosk-checkbox=false
const WS4KP_STICKYHKIOSK = process.env.WS4KP_STICKYHKIOSK || false; // settings-stickyKiosk-checkbox=false
const WS4KP_CUSTOMFEEDEN = process.env.WS4KP_CUSTOMFEEDEN || false; // &settings-customFeedEnable-checkbox=false
const WS4KP_SPEED = process.env.WS4KP_SPEED || "1.0"; /// &settings-speed-select=1.00
const WS4KP_SCANLINEMODE = process.env.WS4KP_SCANLINEMODE || "auto"; // &settings-scanLineMode-select=auto
const WS4KP_UNITS = process.env.WS4KP_UNITS || "auto"; // &settings-units-select=us
const WS4KP_TXTLOC = process.env.WS4KP_TXTLOC || "Detroit%2C+MI%2C+USA"; // &txtLocation=Detroit%2C+MI%2C+USA
const WS4KP_CUSTOMFEEDSTR = process.env.WS4KP_CUSTOMFEEDSTR || ""; // &settings-customFeed-string=
const WS4KP_SHARELINK = process.env.WS4KP_SHARELINK || ""; // &share-link-url=
const WS4KP_SCANLINEEN = process.env.WS4KP_SCANLINEEN || false; // &settings-scanLines-checkbox=false
const WS4KP_MEDIAVOLUME = process.env.WS4KP_MEDIAVOLUME || "0.75"; // &settings-mediaVolume-select=0.75
const WS4KP_LOCQUERY = process.env.WS4KP_LOCQUERY || "Detroit%2C+MI%2C+USA" // &latLonQuery=Detroit%2C+MI%2C+USADetroit%2C+MI%2C+USA
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost';
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = process.env.STREAM_PORT || '9798';
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}/?hazards-checkbox=${WS4KP_HAZARDS}&latest-observations-checkbox=${WS4KP_LATEST}&hourly-checkbox=${WS4KP_HOURLY}&hourly-graph-checkbox=${WS4KP_HOURLYGRAPH}&travel-checkbox=${WS4KP_TRAVEL}&regional-forecast-checkbox=${WS4KP_REGIONAL}&local-forecast-checkbox=${WS4KP_LOCAL}&extended-forecast-checkbox=${WS4KP_EXTENDED}&almanac-checkbox=${WS4KP_ALMANAC}&spc-outlook-checkbox=${WS4KP_SPC}&radar-checkbox=${WS4KP_RADAR}&settings-wide-checkbox=${WS4KP_WIDE}&settings-kiosk-checkbox=${WS4KP_KIOSK}settings-stickyKiosk-checkbox=${WS4KP_STICKYHKIOSK}&settings-customFeedEnable-checkbox=${WS4KP_CUSTOMFEEDEN}&settings-speed-select=${WS4KP_SPEED}&settings-scanLineMode-select=${WS4KP_SCANLINEMODE}&settings-units-select=${WS4KP_UNITS}&txtLocation=${WS4KP_TXTLOC}&settings-customFeed-string=${WS4KP_CUSTOMFEEDSTR}&share-link-url=${WS4KP_SHARELINK}&settings-scanLines-checkbox=${WS4KP_SCANLINEEN}&settings-mediaVolume-select=${WS4KP_MEDIAVOLUME}&latLonQuery=${WS4KP_LOCQUERY}`;
const HLS_SETUP_DELAY = 2000;
const FRAME_RATE = process.env.FRAME_RATE || 10;
const chnlNum = process.env.CHANNEL_NUMBER || '275';

const OUTPUT_DIR = path.join(__dirname, 'output');
const AUDIO_DIR = path.join(__dirname, 'music');
const LOGO_DIR = path.join(__dirname, 'logo');
const HLS_FILE = path.join(OUTPUT_DIR, 'stream.m3u8');

// Ensure directories exist
[OUTPUT_DIR, AUDIO_DIR, LOGO_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

app.use('/stream', express.static(OUTPUT_DIR));
app.use('/logo', express.static(LOGO_DIR));

let ffmpegProc = null;
let ffmpegStream = null;
let browser = null;
let page = null;
let captureInterval = null;
let isStreamReady = false;

const waitFor = ms => new Promise(resolve => setTimeout(resolve, ms));

function getContainerLimits() {
  let cpuQuotaPath = '/sys/fs/cgroup/cpu.max';
  let memLimitPath = '/sys/fs/cgroup/memory.max';
  let cpus = os.cpus().length;
  let memory = os.totalmem();

  try {
    const [quota, period] = fs.readFileSync(cpuQuotaPath, 'utf8').trim().split(' ');
    if (quota !== 'max') {
      cpus = parseFloat((parseInt(quota) / parseInt(period)).toFixed(2));
    }
  } catch {}

  try {
    const raw = fs.readFileSync(memLimitPath, 'utf8').trim();
    if (raw !== 'max') {
      memory = parseInt(raw);
    }
  } catch {}

  return { cpus, memoryMB: Math.round(memory / (1024 * 1024)) };
}

function createAudioInputFile() {
  // Default MP3 files to use if AUDIO_DIR is empty or inaccessible
  const defaultMp3s = [
    '01 Weatherscan Track 26.mp3',
    '02 Weatherscan Track 3.mp3',
    '03 Tropical Breeze.mp3',
    '04 Late Nite Cafe.mp3',
    '05 Care Free.mp3',
    '06 Weatherscan Track 14.mp3',
    '07 Weatherscan Track 18.mp3'
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

  for (let i = 0; i < 24; i++) {
    const startTime = new Date(now.getTime() + i * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 3600 * 1000);
    const start = startTime.toISOString().replace(/[-:T]/g, '').split('.')[0] + ' +0000';
    const end = endTime.toISOString().replace(/[-:T]/g, '').split('.')[0] + ' +0000';
    xml += `
<programme start="${start}" end="${end}" channel="WS4000">
<title lang="en">Local Weather</title>
<desc lang="en">Enjoy your local weather with a touch of nostalgia.</desc>
<icon src="${baseUrl}/logo/ws4000.png" />
</programme>`;
  }

  xml += `</tv>`;
  return xml;
}

async function startBrowser() {
  if (browser) await browser.close().catch(() => {});

  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--ignore-certificate-errors',
      '--window-size=1280,720'
    ],
    defaultViewport: null
  });

  page = await browser.newPage();
  await page.goto(WS4KP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // try {
  //   const zipInput = await page.waitForSelector('input[placeholder="Zip or City, State"], input', { timeout: 5000 });
  //   if (zipInput) {
  //     await zipInput.type(ZIP_CODE, { delay: 100 });
  //     await waitFor(1000);
  //     await page.keyboard.press('ArrowDown');
  //     await waitFor(500);
  //     const goButton = await page.$('button[type="submit"]');
  //     if (goButton) await goButton.click();
  //     else await zipInput.press('Enter');
  //     await page.waitForSelector('div.weather-display, #weather-content', { timeout: 30000 });
  //   }
  // } catch {}

  await page.setViewport({ width: 1280, height: 720 });
}

async function startTranscoding() {
  await startBrowser();
  createAudioInputFile();

  ffmpegStream = new PassThrough();

  ffmpegProc = ffmpeg()
    .input(ffmpegStream)
    .inputFormat('image2pipe')
    .inputOptions([`-framerate ${FRAME_RATE}`])
    .input(path.join(__dirname, 'audio_list.txt'))
    .inputOptions(['-f concat', '-safe 0', '-stream_loop -1'])
    .complexFilter([
      '[0:v]scale=1280:720[v]',
      '[1:a]volume=0.5[a]'
    ])
    .outputOptions([
      '-map [v]',
      '-map [a]',
      '-c:v libx264',
      '-c:a aac',
      '-b:a 128k',
      '-preset ultrafast',
      '-b:v 1000k',
      '-f hls',
      '-hls_time 2',
      '-hls_list_size 2',
      '-hls_flags delete_segments'
    ])
    .output(HLS_FILE)
    .on('start', () => {
      console.log('Started FFmpeg');
      setTimeout(() => isStreamReady = true, HLS_SETUP_DELAY);
    })
    .on('error', async (err) => {
      console.error('FFmpeg error:', err);
      await stopTranscoding();
      startTranscoding();
    })
    .on('end', () => {
      ffmpegProc = null;
      ffmpegStream = null;
      isStreamReady = false;
    });

  captureInterval = setInterval(async () => {
    if (!ffmpegProc || !ffmpegStream || !page) return;
    try {
      if (page.isClosed()) {
        clearInterval(captureInterval);
        await startBrowser();
        captureInterval = setInterval(arguments.callee, 1000 / FRAME_RATE);
        return;
      }
      const screenshot = await page.screenshot({
        type: 'jpeg',
        clip: { x: 4, y: 47, width: 631, height: 480 }
      });
      ffmpegStream.write(screenshot);
    } catch (err) {
      clearInterval(captureInterval);
      await startBrowser();
      captureInterval = setInterval(arguments.callee, 1000 / FRAME_RATE);
    }
  }, 1000 / FRAME_RATE);

  ffmpegProc.run();
}

async function stopTranscoding() {
  if (captureInterval) clearInterval(captureInterval);
  captureInterval = null;
  isStreamReady = false;

  if (ffmpegProc) ffmpegProc.kill('SIGINT');
  ffmpegProc = null;

  if (browser) await browser.close().catch(() => {});
  browser = null;
}

app.get('/playlist.m3u', (req, res) => {
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  const baseUrl = `http://${host}`;
  const m3uContent = `#EXTM3U
#EXTINF:-1 channel-id="WS4000" tvg-id="WS4000" tvg-chno="${chnlNum}" tvc-guide-placeholders="3600" tvc-guide-title="Local Weather" tvc-guide-description="Enjoy your local weather with a touch of nostalgia." tvc-guide-art="${baseUrl}/logo/ws4000.png" tvg-logo="${baseUrl}/logo/ws4000.png",WeatherStar 4000
${baseUrl}/stream/stream.m3u8
`;
  res.set('Content-Type', 'application/x-mpegURL');
  res.send(m3uContent);
});

app.get('/guide.xml', (req, res) => {
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  res.set('Content-Type', 'application/xml');
  res.send(generateXMLTV(host));
});

app.get('/health', (req, res) => {
  res.status(isStreamReady ? 200 : 503).json({ ready: isStreamReady });
});

const { cpus, memoryMB } = getContainerLimits();
console.log(`Running with ${cpus} CPU cores, ${memoryMB}MB RAM`);

app.listen(STREAM_PORT, async () => {
  console.log(`Streaming server running on port ${STREAM_PORT}`);
  await startTranscoding();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received');
  await stopTranscoding();
  process.exit();
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received');
  await stopTranscoding();
  process.exit();
});
