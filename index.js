const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const os = require('os');

const app = express();

// Environment variables
const ZIP_CODE = process.env.ZIP_CODE || '90210';
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost';
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = process.env.STREAM_PORT || '9798';
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}`;
const HLS_SETUP_DELAY = 2000;
const FRAME_RATE = process.env.FRAME_RATE || 10;
const OUTPUT_DIR = path.join(__dirname, 'output');
const AUDIO_DIR = path.join(__dirname, 'music');
const LOGO_DIR = path.join(__dirname, 'logo');
const HLS_FILE = path.join(OUTPUT_DIR, 'stream.m3u8');

// Ensure directories exist
[OUTPUT_DIR, AUDIO_DIR, LOGO_DIR].forEach(dir => {
if (!fs.existsSync(dir)) {
fs.mkdirSync(dir);
}
});

// Serve static files
app.use('/stream', express.static(OUTPUT_DIR));
app.use('/logo', express.static(LOGO_DIR));

// Variables to manage FFmpeg process, browser, and screenshot interval
let ffmpegProc = null;
let ffmpegStream = null;
let browser = null;
let page = null;
let captureInterval = null;
let isStreamReady = false;
let listenersAttached = false; // Prevent duplicate listeners

// Utility function to wait for a specified time
const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to get container resource limits
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
} catch (err) {
console.warn('Unable to read CPU quota, defaulting to host values:', err);
}

try {
const raw = fs.readFileSync(memLimitPath, 'utf8').trim();
if (raw !== 'max') {
memory = parseInt(raw);
}
} catch (err) {
console.warn('Unable to read memory limit, defaulting to host values:', err);
}

return {
cpus,
memoryMB: Math.round(memory / (1024 * 1024))
};
}

// Function to create a looping audio input file for FFmpeg
function createAudioInputFile() {
const mp3Files = [
'01 Weatherscan Track 26.mp3',
'02 Weatherscan Track 3.mp3',
'03 Tropical Breeze.mp3',
'04 Late Nite Cafe.mp3',
'05 Care Free.mp3',
'06 Weatherscan Track 14.mp3',
'07 Weatherscan Track 18.mp3'
];
const audioList = mp3Files.map(file => `file '${path.join(AUDIO_DIR, file)}'`).join('\n');
fs.writeFileSync(path.join(__dirname, 'audio_list.txt'), audioList);
}

// Function to generate XMLTV guide data
<<<<<<< HEAD
function generateXMLTV(hostname) {
  const now = new Date();
  const host = hostname === 'localhost' ? 'host.docker.internal' : hostname;
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv>
  <channel id="WS4000">
    <display-name>WeatherStar 4000</display-name>
    <icon src="http://${host}:${STREAM_PORT}/logo/ws4000.png" />
  </channel>`;

  // Generate 24 hours of hourly repeating programs
  for (let i = 0; i < 24; i++) {
    const startTime = new Date(now.getTime() + i * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 3600 * 1000);
    const start = startTime.toISOString().replace(/[-:T]/g, '').split('.')[0] + ' +0000';
    const end = endTime.toISOString().replace(/[-:T]/g, '').split('.')[0] + ' +0000';
    xml += `
  <programme start="${start}" end="${end}" channel="WS4000">
    <title lang="en">Local Weather</title>
    <desc lang="en">Enjoy your local weather with a touch of nostalgia.</desc>
    <icon src="http://${host}:${STREAM_PORT}/logo/ws4000.png" />
  </programme>`;
  }
=======
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

// Generate 24 hours of hourly repeating programs
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
>>>>>>> ec27b4f (Update index.js and Dockerfile to fix port handling, memory leak, and CPU/memory logging)

xml += `
</tv>`;
return xml;
}

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
console.log(' page opened successfully');

console.log(`Navigating to ${WS4KP_URL}`);
await page.goto(WS4KP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

await page.screenshot({ path: path.join(OUTPUT_DIR, 'post-navigation.jpg') }).catch(err => console.error('Error taking post-navigation screenshot:', err));
console.log('Navigation complete');

try {
console.log('Looking for ZIP code input field...');
const zipInput = await page.waitForSelector('input[placeholder="Zip or City, State"], input', { timeout: 5000 });
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

// Function to start FFmpeg transcoding with audio
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
console.log('Started FFmpeg streaming with audio');
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
console.log('Page is closed, restarting browser');
clearInterval(captureInterval);
captureInterval = null;
await waitFor(1000);
await startBrowser();
captureInterval = setInterval(arguments.callee, 1000 / FRAME_RATE);
return;
}
const screenshot = await page.screenshot({
type: 'jpeg',
clip: { x: 11, y: 40, width: 631, height: 480 }
});
ffmpegStream.write(screenshot);
} catch (err) {
console.error('Error capturing screenshot:', err);
clearInterval(captureInterval);
captureInterval = null;
console.log('Possible resource exhaustion, restarting browser after delay');
await waitFor(1000);
startBrowser;
captureInterval = setInterval(arguments.callee, 1000 / FRAME_RATE);
}
}, 1000 / FRAME_RATE);

ffmpegProc.run();
}

// Endpoint to provide the M3U playlist for Channels
app.get('/playlist.m3u', (req, res) => {
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  const baseUrl = `http://${host}`;
  const m3uContent = `#EXTM3U
#EXTINF:-1 channel-id="weatherStar4000" tvg-id="weatherStar4000" tvg-channel-no="275" tvc-guide-placeholders="3600" tvc-guide-title="Local Weather" tvc-guide-description="Enjoy your local weather with a touch of nostalgia." tvc-guide-art="${baseUrl}/logo/ws4000.png" tvg-logo="${baseUrl}/logo/ws4000.png",WeatherStar 4000
${baseUrl}/stream/stream.m3u8
`;
  res.set('Content-Type', 'application/x-mpegURL');
  res.send(m3uContent);
});

// Endpoint to provide XMLTV guide
app.get('/guide.xml', (req, res) => {
  const host = req.headers.host || `localhost:${STREAM_PORT}`;
  res.set('Content-Type', 'application/xml');
  res.send(generateXMLTV(host));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(isStreamReady ? 200 : 503).json({ ready: isStreamReady });
});

// Log resource settings
const { cpus, memoryMB } = getContainerLimits();
console.log(`Running with ${cpus} CPU cores, ${memoryMB}MB RAM`);

// Start the server and transcoding
app.listen(STREAM_PORT, async () => {
  console.log(`Streaming server running on port ${STREAM_PORT}`);
  console.log(`M3U playlist available at http://${HOSTNAME}:${STREAM_PORT}/playlist.m3u`);
  console.log(`XMLTV guide available at http://${HOSTNAME}:${STREAM_PORT}/guide.xml`);
  console.log(`Health check available at http://${HOSTNAME}:${STREAM_PORT}/health`);
  await startTranscoding();
});

// Prevent duplicate listeners and clean up on exit
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  stopTranscoding();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  stopTranscoding();
  process.exit();
});
