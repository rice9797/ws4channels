# Latest Update

Fixed some users reporting MaxListenersExceeded warning. 

If you are using the recent versions 6.0+ of ws4kp use the "latest" tag.  This version adjusts the crop to fix white lines on the top and right. If you are using older ws4kp use the SHA listed below. 

Merged pull request from @jacroe to try to solve some users having issues with white bars. I never experienced these white bars on the sides. Use the "latest" tag to try this version out and please let me know if you have issues. Hopefully his changes correct it for users with the issue.  I have not tested this version as of yet. 

Reverted back to original amd64 only image due to bugs from merged jasongdove. Use image below instead of Latest tag. 

Merged pull request from @jasongdove to attempt hardware acceleration.  His instructions are as follows: 

To test with NVIDIA, I included --gpus all on my run command, as well as the env var -e "VIDEO_OPTIONS=-c:v h264_nvenc -pix_fmt yuv420p -b:v 2000k".
I personally have not had time to test this.  See issue #11 for context.  

# Known Bugs

Some users report white lines on top and right side of the video after a buggy merge.  The latest tag will to fix this. 

# ws4channels

A Dockerized Node.js application to stream WeatherStar 4000 data into Channels DVR using Puppeteer and FFmpeg.

## Prerequisites
- 850MB availabe RAM
- Docker installed
- WS4KP running (default port 8080)
   https://github.com/netbymatt/ws4kp
## Usage

Build and run the container:

Step 1: Pull the Docker Image

If you are using the recent versions 6.0+ of ws4kp use the "latest" tag. This version adjusts the crop to fix white lines on the top and right. If you are using older ws4kp use the SHA listed below.
```bash

docker pull ghcr.io/rice9797/ws4channels@sha256:8d68bacc7bbe33e2edf9c6bb050fe09a502ea9badb0df0f08b6d0ca28a9842a7
```
Or for Latest tag version:

```bash

docker pull ghcr.io/rice9797/ws4channels:latest
```
If you use the latest tag remember to change the docker run command to use latest tag instead of the sha256 in the example below. 

Step 2: Run the Container

Next, run the container using the following command. This will start the container in detached mode and set the required environment variables.

```bash

docker run -d \
  --name ws4channels \
  --restart unless-stopped \
  --memory="1096m" \
  --cpus="1.0" \
  -p 9798:9798 \
  -e ZIP_CODE=your_zip_code \
  -e WS4KP_HOST=ws4kp_host \
  -e WS4KP_PORT=ws4kp_port \
http://ghcr.io/rice9797/ws4channels@sha256:8d68bacc7bbe33e2edf9c6bb050fe09a502ea9badb0df0f08b6d0ca28a9842a7
```
Example:

 --memory="1096m" --cpus="1.0" -p 9798:9798 -e ZIP_CODE=63101 -e WS4KP_PORT=8080 -e WS4KP_HOST=192.168.1.152 

-1096m=the amount of maximum ram the container can use in mb

-1.0= maximum amount of cpu cores the container can use. Default is 1 core

-63101= enter your zip code 

-WS4KP_PORT= this is the port you set up WeatherStar4000 container with if you didn’t choose another port that container defaults to 8080.

-WS4KP_HOST= the ip of the machine that WeatherStar4000 container runs on. 


Environment Variables

	•  ZIP_CODE: Your ZIP code (default: 90210)
 
	•  WS4KP_HOST: Host running WS4KP (default: localhost)
 
	•  WS4KP_PORT: Port for WS4KP (default: 8080)
 
	•  --cpus: CPU limit (default: 1.0)
 
	•  --memory: RAM limit in MB (default: 1096)
 
	•  FRAME_RATE: Stream frame rate (default: 10)

	•  CHANNEL_NUMBER: Sets the channel number (default: 275)

	* WS4KP_HAZARDS true; // ?hazards-checkbox=true
    * WS4KP_LATEST true; // &latest-observations-checkbox=true
    * WS4KP_HOURLY false; // &hourly-checkbox=false
    * WS4KP_HOURLYGRAPH true; // &hourly-graph-checkbox=true
    * WS4KP_TRAVEL false; // &travel-checkbox=false
    * WS4KP_REGIONAL true; // &regional-forecast-checkbox=true
    * WS4KP_LOCAL true; // &local-forecast-checkbox=true
    * WS4KP_EXTENDED true; // &extended-forecast-checkbox=true
    * WS4KP_ALMANAC true; // &almanac-checkbox=true
    * WS4KP_SPC true; // &spc-outlook-checkbox=true
    * WS4KP_RADAR true; // &radar-checkbox=true
    * WS4KP_WIDE false; // &settings-wide-checkbox=false
    * WS4KP_KIOSK false; // &settings-kiosk-checkbox=false
    * WS4KP_STICKYHKIOSK false; // settings-stickyKiosk-checkbox=false
    * WS4KP_CUSTOMFEEDEN false; // &settings-customFeedEnable-checkbox=false
    * WS4KP_SPEED "1.0"; /// &settings-speed-select=1.00
    * WS4KP_SCANLINEMODE "auto"; // &settings-scanLineMode-select=auto
    * WS4KP_UNITS "auto"; // &settings-units-select=us
    * WS4KP_TXTLOC "Detroit%2C+MI%2C+USA"; // &txtLocation=Detroit%2C+MI%2C+USA
    * WS4KP_CUSTOMFEEDSTR ""; // &settings-customFeed-string=
    * WS4KP_SHARELINK ""; // &share-link-url=
    * WS4KP_SCANLINEEN false; // &settings-scanLines-checkbox=false
    * WS4KP_MEDIAVOLUME "0.75"; // &settings-mediaVolume-select=0.75
    * WS4KP_LOCQUERY "Detroit%2C+MI%2C+USA" // &latLonQuery=Detroit%2C+MI%2C+USADetroit%2C+MI%2C+USA
 

##  Hardware Acceleration Support

Update!! Currently hardware encoding and Multi Arch are not supported. I'm leaving these instructions up in case I can get them working or if those images from the past are still working for others. 

This project supports hardware-accelerated video encoding using `ffmpeg`. To enable it, override the `VIDEO_OPTIONS` environment variable when running the container.

### Intel Quick Sync (QSV)
```bash

--device=/dev/dri \
-e VIDEO_OPTIONS="-c:v h264_qsv -b:v 1000k"
```
### Nvidia NVENC
```bash

--gpus all \
-e VIDEO_OPTIONS="-c:v h264_nvenc -b:v 1000k"
```

### AMD VAAPI

```bash

--device=/dev/dri \
-e VIDEO_OPTIONS="-vaapi_device /dev/dri/renderD128 -c:v h264_vaapi -b:v 1000k -vf format=nv12,hwupload"

```
Docker containers must have access to GPU devices (--gpus all or --device=/dev/dri).
 


### Accessing the Stream


M3U Playlist: 

	http://<ip.of.pc.running.ws4channels>:9798/playlist.m3u
 
Example: http://192.168.1.131:9798/playlist.m3u
In Channels DVR, use MPEG-TS format with this URL.

  Guide Data
  XMLTV Guide:
  
	http://<ip.of.pc.running.ws4channels>:9798/guide.xml
 
Example: http://192.168.1.131:9798/guide.xml


Latest additions
 6/21/25 Update:
  ## Music Configuration
- The application plays MP3 files from the `music` folder in the project root.
- Default tracks included:
  - 01 Weatherscan Track 26.mp3
  - 02 Weatherscan Track 3.mp3
  - 03 Tropical Breeze.mp3
  - 04 Late Nite Cafe.mp3
  - 05 Care Free.mp3
  - 06 Weatherscan Track 14.mp3
  - 07 Weatherscan Track 18.mp3
- To customize, add your own MP3 files to the `music` folder. Only `.mp3` files are included in the stream.
- If no MP3s are found, the default tracks are used.
- After adding your mp3 tracks to the music folder restart the container so the app will pick up the new music. 
 
 Prior Updates:

 -Includes seven looping jazz tracks as background music.
 
-Provides an XMLTV guide with hourly “Local Weather” entries.

-Added guide logo 
 
-Optimized cropping for a clean video feed by removing white bars.

-Changed default cpu and memory limits to 1 cpu core and 1gb ram. Adjust if your system requires.

  
About:

A nostalgic weather streaming solution for Channels DVR, built with Node.js, Puppeteer, and FFmpeg.

[Buy me a coffee ☕](https://www.buymeacoffee.com/rice9797)
