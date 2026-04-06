FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LIBVA_DRIVER_NAME=iHD
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Base packages
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    pciutils \
    usbutils \
    vainfo \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
# NodeSource currently documents the Debian/Ubuntu repo flow for Node 22 installs.
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# FFmpeg + Intel media stack + common runtime libs
RUN apt-get update && apt-get install -y \
    ffmpeg \
    intel-media-va-driver-non-free \
    libvpl2 \
    libva2 \
    libva-drm2 \
    va-driver-all \
    vainfo \
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
    libasound2t64 \
    libxshmfence1 \
    libx11-xcb1 \
    fonts-liberation \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --verbose

COPY . .

RUN mkdir -p /app/music /app/logo

COPY music/*.mp3 /app/music/
COPY logo/*.png /app/logo/

EXPOSE 3000

CMD ["node", "index.js"]