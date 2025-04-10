# ws4channels

A Dockerized Node.js application to stream WeatherStar 4000 data into Channels DVR using Puppeteer and FFmpeg.

## Prerequisites

- Docker installed
- WS4KP running (default port 8080)

## Usage

Build and run the container:

```bash
docker build -t ws4channels .
docker run --name ws4channels --restart unless-stopped --memory="400m" --cpus="0.3" -p 9798:9798 -e ZIP_CODE=your_zip_code -e WS4KP_HOST=ws4kp_host -e WS4KP_PORT=ws4kp_port ws4channels


Environment Variables
		•  ZIP_CODE: Your ZIP code (default: 90210)
		•  WS4KP_HOST: Host running WS4KP (default: localhost)
		•  WS4KP_PORT: Port for WS4KP (default: 8080)
		•  CPU_CORES: CPU limit (default: 0.3)
		•  RAM_LIMIT_MB: RAM limit in MB (default: 400)
		•  FRAME_RATE: Stream frame rate (default: 10)
Accessing the Stream
		•  M3U playlist: http://localhost:9798/playlist.m3u
		•  Health check: http://localhost:9798/health
