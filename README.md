# Latest Update

04/06/2026
- Upgraded base image to **Ubuntu 24.04**
- Upgraded to **Node.js 22**
- Updated audio library to `libasound2t64` (Ubuntu 24.04 renamed package)
- Intel VAAPI driver stack (`intel-media-va-driver-non-free`, `libvpl2`, `libva2`) baked into the image
- Added **Intel iGPU hardware encoding** support via VAAPI — enable with `ENABLE_IGPU=true` (amd64 only)
- Added `WS4KP_INTERNATIONAL` variable for international display offset support
- **Current build is amd64 only.** arm64 support is planned for a future release.

03/07/2026
Added widescreen as default output, randomized music, and expand guide data compatiability for other programs like xTeVe, Telly, Threadfin, Plex, Jellyfin ect.

***Please update/install your WS4KP container to use the following variable:***

WSQS_settings_wide_checkbox=true

Pull ws4kp container.

```bash

docker pull ghcr.io/netbymatt/ws4kp:latest
```

Run ws4kp container.

```bash

docker run -d \
  --name ws4kp \
  --restart unless-stopped \
  -p 9090:8080 \
  -e WSQS_settings_wide_checkbox=true \
  ghcr.io/netbymatt/ws4kp:latest
```

***Please note that this variable goes in the WS4KP container not this ws4channels container.****


Use the :latest tag for these changes.


# Known Bugs


# ws4channels

A Dockerized Node.js application to stream WeatherStar 4000 data into Channels DVR using Puppeteer and FFmpeg.

## Prerequisites

- 850MB availabe RAM
- Docker installed
- WS4KP running and installed with the WSQS_settings_wide_checkbox=true variable.
   https://github.com/netbymatt/ws4kp
  
## Usage

Build and run the container:

Step 1: Pull the Docker Image

```bash

docker pull ghcr.io/rice9797/ws4channels:latest
```

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
http://ghcr.io/rice9797/ws4channels:latest
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
  
    •  SHUFFLE_MUSIC: Randomize the order in which detected mp3s are played (default: false)
  
    •  PERMALINK_URL: Pass configuration parameters via permalink generated from ws4kp/ws4kp-international

	•  WS4KP_INTERNATIONAL: Adjust crop offset when using ws4kp-international (default: false)

	•  ENABLE_IGPU: Enable Intel iGPU hardware encoding via VAAPI (default: false, amd64 only)

## Hardware Acceleration Support

Intel iGPU hardware encoding is supported on **amd64** hosts via VAAPI (`h264_vaapi`). This requires passing the `/dev/dri` device to the container and setting `ENABLE_IGPU=true`.

If `ENABLE_IGPU=true` but `/dev/dri/renderD128` is not found, the container automatically falls back to CPU encoding (`libx264`) and logs a warning.

**arm64 and NVIDIA are not currently supported for hardware encoding.**

### Intel iGPU (VAAPI) — amd64 only

```bash
docker run -d \
  --name ws4channels \
  --restart unless-stopped \
  --memory="1096m" \
  --cpus="1.0" \
  --device=/dev/dri \
  -p 9798:9798 \
  -e ZIP_CODE=your_zip_code \
  -e WS4KP_HOST=ws4kp_host \
  -e WS4KP_PORT=ws4kp_port \
  -e ENABLE_IGPU=true \
  ghcr.io/rice9797/ws4channels:latest
```

### Accessing the Stream

M3U Playlist:

 http://<ip.of.pc.running.ws4channels>:9798/playlist.m3u

Example: <http://192.168.1.131:9798/playlist.m3u>
In Channels DVR, use MPEG-TS format with this URL.

  Guide Data
  XMLTV Guide:
  
 http://<ip.of.pc.running.ws4channels>:9798/guide.xml

Example: <http://192.168.1.131:9798/guide.xml>

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
