# use base image with ffmpeg and hwaccel support
ARG base_image=ghcr.io/ersatztv/ersatztv-ffmpeg
ARG base_image_tag=7.1.1

FROM ${base_image}:${base_image_tag}
ENV NODE_MAJOR=22

# install node
RUN <<EOF 
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
apt-get update && apt-get install nodejs -y
EOF

# Install Puppeteer dependencies
RUN apt-get update && apt-get install -y \
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
RUN npm install

# Copy application code, music, and logo files
COPY . .
RUN mkdir -p /app/music /app/logo
COPY music/*.mp3 /app/music/
COPY logo/*.png /app/logo/

# Use STREAM_PORT environment variable for dynamic port
EXPOSE $STREAM_PORT
ENTRYPOINT ["node", "index.js"]
