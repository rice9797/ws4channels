# ─── Stage 1: Static ffmpeg binaries ────────────────────────────────────────
# mwader/static-ffmpeg provides statically compiled ffmpeg/ffprobe for
# both linux/amd64 and linux/arm64 — replaces the 186-package apt install.
FROM mwader/static-ffmpeg:latest AS ffmpeg

# ─── Stage 2: Production dependencies ────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

COPY package*.json ./
# Install only production deps; skip Puppeteer's bundled Chromium download
# since we'll use the system chromium installed below.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --omit=dev

# ─── Stage 3: Final runtime image ────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Install Chromium from Debian repos.
# This is the correct approach for multi-platform (amd64 + arm64) builds —
# google-chrome-stable only ships x86_64 binaries.
# --no-install-recommends keeps the layer lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    # Required for Chromium headless to function without a display server
    libglib2.0-0 \
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
    # Clean up apt cache — must be in the same RUN layer
    && rm -rf /var/lib/apt/lists/*

# Copy static ffmpeg + ffprobe from stage 1 (~60–80 MB total vs 439 MB from apt)
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Tell Puppeteer where the system Chromium lives and skip its own download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    # Suppress the "Running as root without --no-sandbox is not supported" error
    # in containers. If you run as a non-root user, remove this.
    CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

# Non-root user for better security (optional but recommended)
# RUN useradd -m appuser && chown -R appuser /app
# USER appuser

EXPOSE 3000

CMD ["node", "src/index.js"]
