const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');

const app = express();

// Environment variables
const ZIP_CODE = process.env.ZIP_CODE || '90210';
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost'; // New: configurable host
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = '9798';
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}`; // Updated to use WS4KP_HOST
const HLS_SETUP_DELAY = 2000;
const FRAME_RATE = process.env.FRAME_RATE || 10;
const CPU_CORES = process.env.CPU_CORES || '0.3';
const RAM_LIMIT_MB = process.env.RAM_LIMIT_MB || '400';

const OUTPUT_DIR = path.join(__dirname, 'output');
const HLS_FILE = path.join(OUTPUT_DIR, 'stream.m3u8');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Serve the HLS stream
app.use('/stream', express.static(OUTPUT_DIR));

// Variables to manage FFmpeg process, browser, and screenshot interval
let ffmpegProc = null;
let ffmpegStream = null;
let browser = null;
let page = null;
let captureInterval = null;
let isStreamReady = false;

// Utility function to wait for a specified time
const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to start the browser and navigate to ws4kp
async function startBrowser() {
  if (browser) {
    console.log('Browser already running, closing existing instance');
    await browser.close().catch(err => console.error('Error closing existing browser:', err));
  }

  console.log('Launching Puppeteer browser...');
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-features=TranslateUI',
      '--window-size=1280,720'
    ],
    defaultViewport: null
  });
  console.log('Browser launched successfully');

  console.log('Opening new page...');
  page = await browser.newPage();
  console.log('New page opened successfully');

  console.log(`Navigating to ${WS4KP_URL}`);
  await page.goto(WS4KP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'post-navigation.jpg') }).catch(err => console.error('Error taking post-navigation screenshot:', err));
  console.log('Navigation complete');

  try {
    console.log('Looking for ZIP code input field...');
    const zipInput = await page.waitForSelector('input[placeholder="Zip or City, State"]', { timeout: 5000 });
    if (zipInput) {
      console.log('ZIP code input found, entering ZIP code');
      await zipInput.type(ZIP_CODE, { delay: 100 });

      console.log('Waiting for autocomplete suggestions...');
      await page.waitForSelector('.autocomplete-suggestion, ul li, [role="option"]', { timeout: 3000 })
        .catch(() => console.log('No autocomplete selector found, proceeding anyway'));
      await waitFor(1000);

      console.log('Selecting first autocomplete suggestion');
      await page.keyboard.press('ArrowDown');
      await waitFor(500);

      console.log('Looking for GO button...');
      const goButton = await page.waitForSelector('button:where(:has-text("go"), :has-text("GO")), button[type="submit"]', { timeout: 5000 })
        .catch(async (err) => {
          console.error('Failed to find GO button:', err);
          console.log('GO button not found, pressing Enter as fallback');
          await zipInput.press('Enter');
          return null;
        });

      if (goButton) {
        console.log('Clicking GO button');
        await goButton.click();
      }

      console.log(`Submitted ZIP code ${ZIP_CODE}`);
      await page.waitForSelector('div.weather-display, #weather-content', { timeout: 30000 })
        .catch(async (err) => {
          console.error('Weather content not found, taking debug screenshot:', err);
          await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-zip-failure.jpg') }).catch(() => {});
        });
    } else {
      console.log('No ZIP code input found, assuming already set');
    }
  } catch (err) {
    console.error('Error setting ZIP code:', err);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-error.jpg') }).catch(() => {});
    throw err;
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'post-setup.jpg') }).catch(err => console.error('Error taking post-setup screenshot:', err));
  console.log('Browser setup complete');

  await page.setViewport({ width: 1280, height: 720 });
  console.log('Set viewport to 1280x720');
}

// Function to start FFmpeg transcoding and keep it running
async function startTranscoding() {
  await startBrowser();

  ffmpegStream = new PassThrough();

  ffmpegProc = ffmpeg(ffmpegStream)
    .inputFormat('image2pipe')
    .inputOptions([`-framerate ${FRAME_RATE}`])
    .outputOptions([
      '-vf scale=1280:720',
      '-c:v libx264',
      '-preset ultrafast',
      '-b:v 1000k',
      '-f hls',
      '-hls_time 2',
      '-hls_list_size 2',
      '-hls_flags delete_segments'
    ])
    .output(HLS_FILE)
    .on('start', () => {
      console.log('Started FFmpeg streaming');
      setTimeout(() => {
        isStreamReady = true;
        console.log('HLS stream is ready');
      }, HLS_SETUP_DELAY);
    })
    .on('error', (err) => {
      console.error('FFmpeg error:', err);
      ffmpegProc = null;
      ffmpegStream = null;
      isStreamReady = false;
      startTranscoding().catch(err => console.error('Failed to restart transcoding:', err));
    })
    .on('end', () => {
      console.log('FFmpeg stopped');
      ffmpegProc = null;
      ffmpegStream = null;
      isStreamReady = false;
    });

  captureInterval = setInterval(async () => {
    if (!ffmpegProc || !ffmpegStream || !page) {
      clearInterval(captureInterval);
      captureInterval = null;
      return;
    }
    try {
      if (page.isClosed()) {
        console.log('Page is closed, restarting browser after delay');
        clearInterval(captureInterval);
        captureInterval = null;
        await waitFor(1000);
        await startBrowser();
        captureInterval = setInterval(arguments.callee, 1000 / FRAME_RATE);
        return;
      }
      const screenshot = await page.screenshot({
        type: 'jpeg',
        clip: { x: 0, y: 40, width: 656, height: 480 }
      });
      ffmpegStream.write(screenshot);
    } catch (err) {
      console.error('Error capturing screenshot:', err);
      clearInterval(captureInterval);
      captureInterval = null;
      console.log('Possible resource exhaustion (RAM/CPU), restarting browser after delay');
      await waitFor(1000);
      await startBrowser();
      captureInterval = setInterval(arguments.callee, 1000 / FRAME_RATE);
    }
  }, 1000 / FRAME_RATE);

  ffmpegProc.run();
}

// Endpoint to provide the M3U playlist for Channels DVR
app.get('/playlist.m3u', (req, res) => {
  const host = req.hostname === 'localhost' ? 'host.docker.internal' : req.hostname;
  const m3uContent = `#EXTM3U
#EXTINF:-1,WeatherStar 4000
http://${host}:${STREAM_PORT}/stream/stream.m3u8
`;
  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(m3uContent);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(isStreamReady ? 200 : 503).json({ ready: isStreamReady });
});

// Log resource settings
console.log(`Running with CPU cores: ${CPU_CORES}, RAM limit: ${RAM_LIMIT_MB}MB`);

// Start the server and transcoding
app.listen(STREAM_PORT, async () => {
  console.log(`Streaming server running on port ${STREAM_PORT}`);
  console.log(`M3U playlist available at http://localhost:${STREAM_PORT}/playlist.m3u`);
  console.log(`Health check available at http://localhost:${STREAM_PORT}/health`);
  await startTranscoding();
});

// Clean up on process exit
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (captureInterval) clearInterval(captureInterval);
  if (ffmpegProc) ffmpegProc.kill('SIGINT');
  if (ffmpegStream) ffmpegStream.end();
  if (browser) await browser.close();
  process.exit(0);
});
