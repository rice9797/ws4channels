FROM node:18

# Install FFmpeg and Puppeteer dependencies
RUN apt-get update && apt-get install -y \
  ffmpeg \
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
  libasound2 \
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

