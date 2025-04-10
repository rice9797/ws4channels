# ws4channels

A Dockerized Node.js application to stream WeatherStar 4000 data into Channels DVR using Puppeteer and FFmpeg.

## Prerequisites
- 450MB availabe RAM
- Docker installed
- WS4KP running (default port 8080)
   https://weatherstar.netbymatt.com/
## Usage

Build and run the container:

Step 1: Pull the Docker Image

First, pull the latest version of the ws4channels image from GitHub Container Registry by running:
```bash

docker pull ghcr.io/rice9797/ws4channels:latest
```

Step 2: Run the Container

Next, run the container using the following command. This will start the container in detached mode and set the required environment variables.

```bash

docker run -d \
  --name ws4channels \
  --restart unless-stopped \
  --memory="400m" \
  --cpus="0.3" \
  -p 9798:9798 \
  -e ZIP_CODE=your_zip_code \
  -e WS4KP_HOST=ws4kp_host \
  -e WS4KP_PORT=ws4kp_port \
  ghcr.io/rice9797/ws4channels:latest
```
Example:

 --memory="400m" --cpus="0.3" -p 9798:9798 -e ZIP_CODE=63101 -e WS4KP_PORT=8080 -e WS4KP_HOST=192.168.1.152 

-400m =the amount of maximum ram the container can use in mb

-0.3= amount of cpu maximum default 1/3 of a core

-63101= enter your zip code 

-WS4KP_PORT= this is the port you set up WeatherStar4000 container with if you didn’t choose another port that container defaults to 8080.

-WS4KP_HOST= the ip of the machine that WeatherStar4000 container runs on. 


Environment Variables

		•  ZIP_CODE: Your ZIP code (default: 90210)
  
		•  WS4KP_HOST: Host running WS4KP (default: localhost)
  
		•  WS4KP_PORT: Port for WS4KP (default: 8080)
  
		•  CPU_CORES: CPU limit (default: 0.3)
  
		•  RAM_LIMIT_MB: RAM limit in MB (default: 400)
  
		•  FRAME_RATE: Stream frame rate (default: 10)

  
Accessing the Stream M3U playlist:

		http://ip.of.pc.running.ws4channels:9798/playlist.m3u

Example:
http://192.168.1.131:9798/playlist.m3u
In Channels DVR use MPEG-TS for stream format and URL with above example
		•  Health check: http://localhost:9798/health
