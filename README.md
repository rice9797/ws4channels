# ws4channels

A Dockerized Node.js application to stream WeatherStar 4000 data into Channels DVR using Puppeteer and FFmpeg.

This requires a netbymatt/ws4k service running to emulate a 90s-style WeatherStar 4000, hosted via http.
This service creates an M3U video stream of the forecast using Puppeteer to screen cap the page, creates the video with ffmepg, and adds music and XMLTV support.

### Changes from source repo

This version is forked from: https://github.com/rice9797/ws4channels. It adds ffmpeg screen capturing for improved performance, and extra environment variables.

## Prerequisites

- 850MB availabe RAM
- Docker installed
- WS4KP running and installed
   https://github.com/netbymatt/ws4kp

## Usage

Build and run the container using either method.

### Method 1

Step 1: Pull and run a ws4kp container.
```
docker pull ghcr.io/netbymatt/ws4kp:latest
docker run -d \
  --name ws4kp \
  --restart unless-stopped \
  -p 9090:8080 \
  ghcr.io/netbymatt/ws4kp:latest
```

Step 2: Pull the ws4channels Docker Image:
```
docker pull ghcr.io/flashdim/ws4channels:latest
```
Step 3: Run the Container

Next, run the container using the following command. This will start the container in detached mode and set the required environment variables.
```
docker run -d \
  --name ws4channels \
  --restart unless-stopped \
  --memory="1096m" \
  --cpus="1.0" \
  -p 9798:9798 \
  -e PERMALINK_URL=your_permalink_generated_from_ws4kp \
  -e ZIP_CODE=your_zip_code \
  -e WS4KP_HOST=ws4kp_host \
  -e WS4KP_PORT=ws4kp_port \
http://ghcr.io/flashdim/ws4channels:latest
```

Examples:

--memory="1096m" --cpus="1.0" -p 9798:9798 -e ZIP_CODE=63101 -e WS4KP_PORT=8080 -e WS4KP_HOST=192.168.1.152

--memory=2048m

--cpus=2.0

-e PERMALINK_URL=Add if you created a permalink within ws4kp, delete this variable if not.

-e ZIP_CODE=63101

-e WS4KP_HOST=myws4kp

-e WS4KP_PORT=8080

### Method 2

Create or add to a docker-compose.yml file, with ws4kp as an example:
```
services:
  ws4kp:
    image: ghcr.io/netbymatt/ws4kp
    container_name: ws4kp
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      - TZ=America/Detroit
      - WSQS_hazards=false
      - WSQS_spc-outlook=false
      - WSQS_current_weather=true
      - WSQS_scanlines=true
    ports:
      - 8080:8080
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /opt/ws4kp/music:/usr/share/nginx/html/music
    networks:
      my_network:
        ipv4_address: 192.168.1.152
    restart: unless-stopped
  ws4channels:
    image: ghcr.io/flashdim/ws4channels:latest
    container_name: ws4channels
    devices:
      - /dev/dri
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      - TZ=America/Detroit
      - ZIP_CODE=63101
      - WS4KP_HOST=ws4kp
      - WS4KP_PORT=8080
      - VIEW_MODE=standard
      - KBPS_BITRATE=1000
      - FRAME_RATE=15
      - SHOW_SONG_TITLE=false
      - SHUFFLE_MUSIC=true
      - WS4KP_FORECAST_CD=1.0
      - WS4KP_SCANLINES=false
      - WS4KP_CURRENT_WEATHER=true
      - WS4KP_LATEST_OBSERVATIONS=true
      - WS4KP_HOURLY=true
      - WS4KP_HOURLY_GRAPH=false
      - WS4KP_TRAVEL=true
      - WS4KP_REGIONAL_FORECAST=true
      - WS4KP_LOCAL_FORECAST=true
      - WS4KP_EXTENDED_FORECAST=true
      - WS4KP_ALMANAC=true
      - WS4KP_RADAR=true
    ports:
      - 9798:9798
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /opt/ws4kp/music:/app/music
    networks:
      my_network:
        ipv4_address: 192.168.1.131
    restart: unless-stopped
```

Then start the container:
```docker compose up```

# Environment Variables

	•  --cpus: CPU limit (default: 1.0)
 
	•  --memory: RAM limit in MB (default: 1096)
 
	•  KBPS_BITRATE: Stream bitrate (default: 1000)

	•  FRAME_RATE: Stream frame rate (default: 15)

	•  CHANNEL_NUMBER: Sets the channel number (default: 275)
  
	•  SHOW_SONG_TITLE: Populates the "Custom Text" field in WS4K with the currently playing song. (default: false)
  
	•  SHUFFLE_MUSIC: Randomize the order in which detected mp3s are played (default: false)
  
	•  PERMALINK_URL (optional): Pass configuration parameters via permalink generated from ws4kp. You can use that, or the individual settings below.

	•  ZIP_CODE: Your ZIP code (default: 90210)

	•  WS4KP_HOST: Host running WS4KP (default: localhost)

	•  WS4KP_PORT: Port for WS4KP (default: 8080)

	•  WS4KP_FORECAST_CD: The cooldown in seconds between forecast screens (default 1.0)

	•  VIEW_MODE: One of: `standard`, `wide` (default), `wide-enhanced` or `portrait-enhanced`. These values correspond to the modes available in ws4kp, with the last two only available in ws4kp v7.0+. Video sizes are 640x480, 1280x720 or 720x1280 to match.

	•  WS4KP_SCANLINES: Enable scanlines filter (default: false)

	•  Forecast screens (all optional):
	   WS4KP_CURRENT_WEATHER: (default: true)
	   WS4KP_LATEST_OBSERVATIONS: (default: true)
	   WS4KP_HOURLY: (default: true)
	   WS4KP_HOURLY_GRAPH: (default: false)
	   WS4KP_TRAVEL: (default: false)
	   WS4KP_REGIONAL_FORECAST: (default: true)
	   WS4KP_LOCAL_FORECAST: (default: true)
	   WS4KP_EXTENDED_FORECAST: (default: true)
	   WS4KP_ALMANAC: (default: false)
	   WS4KP_RADAR: (default: true)


## Hardware Acceleration, ARM Multi Arch Support

Currently hardware encoding and Multi Arch are not supported. 


### Accessing the Stream

M3U Playlist:

 http://<ip.of.pc.running.ws4channels>:9798/playlist.m3u

Example: <http://192.168.1.131:9798/playlist.m3u>
In Channels DVR, use MPEG-TS format with this URL.

  Guide Data
  XMLTV Guide:
  
 http://<ip.of.pc.running.ws4channels>:9798/guide.xml

Example: <http://192.168.1.131:9798/guide.xml>

## Music Configuration

By default, the application plays MP3 files from the `music` folder in the project root.
  
To customize, add your own MP3 files to the `music` folder. Only `.mp3` files are included in the stream.
If no MP3s are found, the default tracks are used.
After adding your mp3 tracks to the music folder restart the container so the app will pick up the new music.

