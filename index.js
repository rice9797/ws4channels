const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const os = require('os');

const app = express();

const VERSION = '2.0'; // version 2.0 logging
const ZIP_CODE = process.env.ZIP_CODE || '90210';
const WS4KP_HOST = process.env.WS4KP_HOST || 'localhost';
const WS4KP_PORT = process.env.WS4KP_PORT || '8080';
const STREAM_PORT = process.env.STREAM_PORT || '9798';
const WS4KP_URL = `http://${WS4KP_HOST}:${WS4KP_PORT}`;
const PERMALINK_URL = process.env.PERMALINK_URL || null;
const HLS_SETUP_DELAY = 2000;
const FRAME_RATE = process.env.FRAME_RATE || 10;

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
let captureInterval = null;
let isStreamReady = false;

const waitFor = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function startBrowser() {
  if(browser) await browser.close().catch(()=>{});
  browser = await puppeteer.launch({
    headless: true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-infobars','--ignore-certificate-errors','--window-size=1280,720'],
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
}

async function startTranscoding() {
  await startBrowser();
  createAudioInputFile();
  ffmpegStream = new PassThrough();
  ffmpegProc = ffmpeg()
    .input(ffmpegStream)
    .inputFormat('image2pipe')
    .inputOptions([`-framerate ${FRAME_RATE}`])
    .input(path.join(__dirname,'audio_list.txt'))
    .inputOptions(['-f concat','-safe 0','-stream_loop -1','-vcodec png'])
    .complexFilter([`[0:v]scale=${VIEW_DIMENSIONS.width}:${VIEW_DIMENSIONS.height}[v]`,'[1:a]volume=0.5[a]'])
    .outputOptions(['-map [v]','-map [a]','-c:v libx264','-c:a aac','-b:a 128k','-preset ultrafast','-b:v 1000k','-f hls','-hls_time 2','-hls_list_size 2','-hls_flags delete_segments'])
    .output(HLS_FILE)
    .on('start',()=>{ console.log(`Started FFmpeg - Version ${VERSION}`); setTimeout(()=>isStreamReady=true,HLS_SETUP_DELAY); })
    .on('error', async err=>{ console.error('FFmpeg error:',err); await stopTranscoding(); startTranscoding(); })
    .on('end',()=>{ ffmpegProc=null; ffmpegStream=null; isStreamReady=false; });

  captureInterval = setInterval(async ()=>{
    if(!ffmpegProc || !ffmpegStream || !page) return;
    try{
      if(page.isClosed()){ await startBrowser(); return; }
      // Updated 16:9 capture for version 1.6
      const screenshot = await page.screenshot({
        type:'png',
        clip:{ x:0, y:0, ...VIEW_DIMENSIONS } // crop top, right, and bottom based on your measurements
      });
      ffmpegStream.write(screenshot);
    } catch(err){
      console.warn('Capture error, retrying...', err.message);
      await startBrowser();
    }
  },1000/FRAME_RATE);

  ffmpegProc.run();
}

async function stopTranscoding(){
  if(captureInterval) clearInterval(captureInterval);
  captureInterval=null; isStreamReady=false;
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

app.get('/health',(req,res)=>{ res.status(isStreamReady?200:503).json({ready:isStreamReady}); });

const { cpus, memoryMB } = getContainerLimits();
console.log(`Version ${VERSION} | Running with ${cpus} CPU cores, ${memoryMB}MB RAM`);

app.listen(STREAM_PORT, async ()=>{
  console.log(`Streaming server running on port ${STREAM_PORT}`);
  await startTranscoding();
});

process.on('SIGINT', async ()=>{ console.log('SIGINT received'); await stopTranscoding(); process.exit(); });
process.on('SIGTERM', async ()=>{ console.log('SIGTERM received'); await stopTranscoding(); process.exit(); });
