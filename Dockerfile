FROM apify/actor-node:16

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    zip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp and Google Drive API
RUN pip3 install --user yt-dlp google-api-python-client google-auth-httplib2 google-auth-oauthlib

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Install npm dependencies
RUN npm install

# Copy source code
COPY . ./

# Run the Actor
CMD ["npm", "start"]
