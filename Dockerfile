FROM node:22-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV LIBVA_DRIVER_NAME=iHD
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install Node.js 18
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

# Install FFmpeg, Intel media drivers, and Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium-browser \
    intel-media-va-driver-non-free \
    libva-drm2 \
    libva2 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --verbose

# Copy application code, music, and logo files
COPY . .

RUN mkdir -p /app/music /app/logo

COPY music/*.mp3 /app/music/
COPY logo/*.png /app/logo/

# Use STREAM_PORT environment variable for dynamic port
EXPOSE $STREAM_PORT

CMD ["node", "index.js"]