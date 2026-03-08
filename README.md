# Latest Update

03/07/2026
Attempt to default the output to widescreen, randomize music, and expand guide data compatiability for other programs like xTeVe, Telly, Threadfin, Plex, Jellyfin ect.

***Please update you WS4KP container to use the following variable:***

WSQS_settings_wide_checkbox=true

***Please not that this variable goes in the WS4KP container not this ws4channels container.****

Use the :latest tag for these changes.


# Known Bugs


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


##  Hardware Acceleration Support

Update!! Currently hardware encoding and Multi Arch are not supported. 


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
