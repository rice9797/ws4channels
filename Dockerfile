FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LIBVA_DRIVER_NAME=iHD
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Base packages
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    vainfo \
    pciutils \
    usbutils \
    xdg-utils \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y \
      nodejs \
      && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && apt-get install -y \
      google-chrome-stable \
      && rm -rf /var/lib/apt/lists/*

# FFmpeg + Intel media stack + Puppeteer/Chrome runtime deps
RUN apt-get update && apt-get install -y \
    ffmpeg \
    intel-media-va-driver-non-free \
    libvpl2 \
    libva2 \
    libva-drm2 \
    va-driver-all \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxfixes3 \
    libxext6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxshmfence1 \
    libasound2t64 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --verbose

COPY . .

RUN mkdir -p /app/music /app/logo

COPY music/*.mp3 /app/music/
COPY logo/*.png /app/logo/

EXPOSE 9798

CMD ["node", "index.js"]