const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const os = require('os');

const app = express();

const ZIP_CODE = process.env.ZIP_CODE || '90210';
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost';
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = parseInt(process.env.STREAM_PORT || '9798', 10);
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}`;
const HLS_SETUP_DELAY = 2000;
const FRAME_RATE = parseInt(process.env.FRAME_RATE || '10', 10);
const chnlNum = process.env.CHANNEL_NUMBER || '275';

const OUTPUT_DIR = path.join(__dirname, 'output');
const AUDIO_DIR = path.join(__dirname, 'music');
const LOGO_DIR = path.join(__dirname, 'logo');
const HLS_FILE = path.join(OUTPUT_DIR, 'stream.m3u8');
const AUDIO_LIST_FILE = path.join(__dirname, 'audio_list.txt');

// Ensure directories exist
[OUTPUT_DIR, AUDIO_DIR, LOGO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use('/stream', express.static(OUTPUT_DIR));
app.use('/logo', express.static(LOGO_DIR));

let ffmpegProc = null;
let ffmpegStream = null;
let browser = null;
let page = null;
let captureInterval = null;
let isStreamReady = false;
let restarting = false;

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getContainerLimits() {
  const cpuQuotaPath = '/sys/fs/cgroup/cpu.max';
  const memLimitPath = '/sys/fs/cgroup/memory.max';
  let cpus = os.cpus().length;
  let memory = os.totalmem();

  try {
    const [quota, period] = fs.readFileSync(cpuQuotaPath, 'utf8').trim().split(' ');
    if (quota !== 'max') {
      cpus = parseFloat((parseInt(quota, 10) / parseInt(period, 10)).toFixed(2));
    }
  } catch {}

  try {
    const raw = fs.readFileSync(memLimitPath, 'utf8').trim();
    if (raw !== 'max') {
      memory = parseInt(raw, 10);
    }
  } catch {}

  return { cpus, memoryMB: Math.round(memory / (1024 * 1024)) };
}

function createAudioInputFile() {
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
    files = fs.readdirSync(AUDIO_DIR).filter((file) => file.toLowerCase().endsWith('.mp3'));
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
  const audioList = files
    .map((file) => `file '${path.join(AUDIO_DIR, file).replace(/'/g, "'\\''")}'`)
    .join('\n');

  fs.writeFileSync(AUDIO_LIST_FILE, audioList);
}

function xmltvDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss} +0000`;
}

function generateXMLTV(host) {
  const baseUrl = `http://${host}`;

  const now = new Date();
  now.setUTCMinutes(0, 0, 0);

  const hours = 72;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="ws4channels" source-info-name="ws4channels">
  <channel id="WS4000">
    <display-name lang="en">WeatherStar 4000</display-name>
    <display-name lang="en">${chnlNum} WeatherStar 4000</display-name>
    <icon src="${baseUrl}/logo/ws4000.png"/>
  </channel>
`;

  for (let i = 0; i < hours; i++) {
    const startTime = new Date(now.getTime() + i * 3600 * 1000);
    const stopTime = new Date(startTime.getTime() + 3600 * 1000);

    xml += `  <programme start="${xmltvDate(startTime)}" stop="${xmltvDate(stopTime)}" channel="WS4000">
    <title lang="en">Local Weather</title>
    <sub-title lang="en">WeatherStar 4000</sub-title>
    <desc lang="en">Enjoy your local weather with a touch of nostalgia.</desc>
    <category lang="en">Weather</category>
    <icon src="${baseUrl}/logo/ws4000.png"/>
  </programme>
`;
  }

  xml += `</tv>\n`;
  return xml;
}

app.get('/playlist.m3u', (req, res) => {
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  const baseUrl = `http://${host}`;

  const m3uContent = `#EXTM3U
#EXTINF:-1 channel-id="WS4000" tvg-id="WS4000" tvg-name="WeatherStar 4000" tvg-chno="${chnlNum}" tvg-logo="${baseUrl}/logo/ws4000.png",WeatherStar 4000
${baseUrl}/stream/stream.m3u8
`;

  res.set('Content-Type', 'application/x-mpegURL; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(m3uContent);
});

app.get('/guide.xml', (req, res) => {
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(generateXMLTV(host));
});

async function startBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    page = null;
  }

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
  await page.setViewport({ width: 1280, height: 720 });

  await page.goto(WS4KP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  try {
    const zipInput = await page.waitForSelector(
      'input[placeholder="Zip or City, State"], input',
      { timeout: 5000 }
    );

    if (zipInput) {
      await zipInput.click({ clickCount: 3 }).catch(() => {});
      await zipInput.type(ZIP_CODE, { delay: 100 });
      await waitFor(1000);
      await page.keyboard.press('ArrowDown').catch(() => {});
      await waitFor(500);

      const goButton = await page.$('button[type="submit"]');
      if (goButton) {
        await goButton.click();
      } else {
        await zipInput.press('Enter');
      }

      await page.waitForSelector('div.weather-display, #weather-content', { timeout: 30000 });
    }
  } catch (err) {
    console.warn(`ZIP entry step skipped or failed: ${err.message}`);
  }
}

async function restartTranscoding(reason) {
  if (restarting) return;
  restarting = true;

  try {
    console.warn(`Restarting transcoder: ${reason}`);
    await stopTranscoding();
    await waitFor(2000);
    await startTranscoding();
  } catch (err) {
    console.error('Restart failed:', err);
  } finally {
    restarting = false;
  }
}

async function captureFrame() {
  if (!ffmpegProc || !ffmpegStream || !page) return;

  try {
    if (page.isClosed()) {
      throw new Error('Browser page is closed');
    }

    const screenshot = await page.screenshot({
      type: 'jpeg',
      clip: { x: 4, y: 47, width: 631, height: 480 }
    });

    ffmpegStream.write(screenshot);
  } catch (err) {
    console.error('Capture error:', err.message);
    await restartTranscoding(`capture failure: ${err.message}`);
  }
}

async function startTranscoding() {
  await startBrowser();
  createAudioInputFile();

  ffmpegStream = new PassThrough();

  ffmpegProc = ffmpeg()
    .input(ffmpegStream)
    .inputFormat('image2pipe')
    .inputOptions([`-framerate ${FRAME_RATE}`])
    .input(AUDIO_LIST_FILE)
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
      '-pix_fmt yuv420p',
      '-f hls',
      '-hls_time 2',
      '-hls_list_size 2',
      '-hls_flags delete_segments'
    ])
    .output(HLS_FILE)
    .on('start', () => {
      console.log('Started FFmpeg');
      setTimeout(() => {
        isStreamReady = true;
      }, HLS_SETUP_DELAY);
    })
    .on('error', async (err) => {
      console.error('FFmpeg error:', err.message || err);
      if (!restarting) {
        await restartTranscoding(`ffmpeg error: ${err.message || err}`);
      }
    })
    .on('end', () => {
      ffmpegProc = null;
      ffmpegStream = null;
      isStreamReady = false;
    });

  captureInterval = setInterval(() => {
    captureFrame().catch((err) => {
      console.error('Unexpected capture loop error:', err.message || err);
    });
  }, Math.max(100, Math.floor(1000 / FRAME_RATE)));

  ffmpegProc.run();
}

async function stopTranscoding() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  isStreamReady = false;

  if (ffmpegStream) {
    try {
      ffmpegStream.end();
    } catch {}
    ffmpegStream = null;
  }

  if (ffmpegProc) {
    try {
      ffmpegProc.kill('SIGINT');
    } catch {}
    ffmpegProc = null;
  }

  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    page = null;
  }
}

app.get('/health', (req, res) => {
  res.status(isStreamReady ? 200 : 503).json({ ready: isStreamReady });
});

const { cpus, memoryMB } = getContainerLimits();
console.log(`Running with ${cpus} CPU cores, ${memoryMB}MB RAM`);

app.listen(STREAM_PORT, async () => {
  console.log(`Streaming server running on port ${STREAM_PORT}`);
  try {
    await startTranscoding();
  } catch (err) {
    console.error('Failed to start transcoding:', err);
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT received');
  await stopTranscoding();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received');
  await stopTranscoding();
  process.exit(0);
});
