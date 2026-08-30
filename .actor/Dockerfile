FROM node:16-bullseye

# Force cache invalidation
RUN echo "Build timestamp: $(date)"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    zip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install specific version of yt-dlp that supports --js-runtimes
RUN pip3 install "yt-dlp<2024.1.0" google-api-python-client google-auth-httplib2 google-auth-oauthlib

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Install npm dependencies
RUN npm install

# Copy source code
COPY . ./

# Run the Actor
CMD ["npm", "start"]
