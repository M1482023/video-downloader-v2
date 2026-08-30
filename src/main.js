import { Actor, log, ProxyConfiguration } from 'apify';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

console.log('🚀 Starting to load modules...');

// Main Actor function
Actor.main(async () => {
    console.log('🎬 Inside Actor.main');
    await Actor.init();
    console.log('✅ Actor.init completed');

    log.info('🎬 Video Downloader Actor started');

    // Get input from the user
    const input = await Actor.getInput();
    const {
        videoUrl,
        cookies,
        poToken,
        proxyConfiguration,
        platform = 'auto',
        uploadToDrive = false,
        driveFolderId = '',
        googleClientId = '',
        googleClientSecret = '',
        googleRefreshToken = '',
        maxVideosBeforeUpload = 30
    } = input;

    if (!videoUrl) {
        throw new Error('❌ videoUrl is required');
    }

    log.info(`📥 Video URL: ${videoUrl}`);
    log.info(`🍪 Cookies provided: ${cookies ? 'Yes' : 'No'}`);
    log.info(`🔑 PO Token provided: ${poToken ? 'Yes' : 'No'}`);
    log.info(`🌐 Proxy configuration: ${proxyConfiguration?.useApifyProxy ? 'Apify Proxy enabled' : 'No proxy'}`);
    log.info(`🎯 Platform: ${platform}`);
    log.info(`☁️  Upload to Drive: ${uploadToDrive ? 'Yes' : 'No'}`);
    if (uploadToDrive) {
        log.info(`📁 Drive Folder ID: ${driveFolderId || 'Root folder'}`);
        log.info(`🔑 Google Client ID: ${googleClientId ? 'Provided' : 'Missing'}`);
        log.info(`🔑 Google Client Secret: ${googleClientSecret ? 'Provided' : 'Missing'}`);
        log.info(`🔑 Google Refresh Token: ${googleRefreshToken ? 'Provided' : 'Missing'}`);
    }

    // Create temporary directories
    const tempDir = path.join(os.tmpdir(), 'video-downloader-' + Date.now());
    const downloadDir = path.join(tempDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });

    log.info(`📁 Created temp directory: ${tempDir}`);

    // Maximum videos before auto-upload and stop
    const MAX_VIDEOS_BEFORE_UPLOAD = maxVideosBeforeUpload > 0 ? maxVideosBeforeUpload : Infinity;
    let downloadedVideosCount = 0;
    let shouldStopDownload = false;

    if (maxVideosBeforeUpload > 0) {
        log.info(`🎯 Auto-upload limit: ${maxVideosBeforeUpload} videos`);
    } else {
        log.info('🎯 Auto-upload limit: disabled');
    }

    // Initialize Apify Proxy if configured
    let apifyProxy = null;
    let proxyUrl = null;
    
    if (proxyConfiguration?.useApifyProxy) {
        log.info('🌐 Initializing Apify Proxy...');
        try {
            apifyProxy = new ProxyConfiguration({
                groups: proxyConfiguration.apifyProxyGroups,
                countryCode: proxyConfiguration.countryCode,
            });
            proxyUrl = await apifyProxy.newUrl();
            log.info(`✅ Apify Proxy initialized: ${proxyUrl}`);
        } catch (e) {
            log.warning(`⚠️  Failed to initialize Apify Proxy: ${e.message}`);
            log.warning('⚠️  Continuing without proxy...');
        }
    }

    try {
        // Step 1: Check dependencies
        log.info('🔧 Checking dependencies...');
        
        // Check if yt-dlp is available
        try {
            execSync('yt-dlp --version', { stdio: 'inherit' });
            log.info('✅ yt-dlp is available');
        } catch (e) {
            throw new Error('❌ yt-dlp is not available. Please ensure it is installed in the Docker image.');
        }

        // Step 2: Detect platform if auto
        let detectedPlatform = platform;
        if (platform === 'auto') {
            detectedPlatform = detectPlatform(videoUrl);
            log.info(`🔍 Detected platform: ${detectedPlatform}`);
        }

        // Step 3: Save cookies if provided
        let cookiesFile = null;
        if (cookies) {
            cookiesFile = path.join(tempDir, 'cookies.txt');
            fs.writeFileSync(cookiesFile, cookies);
            log.info('🍪 Cookies saved to file');
            
            // Check if cookies are actually valid (not just template)
            const hasValidCookies = cookies.includes('.youtube.com') || cookies.includes('SAPISID') || cookies.includes('__Secure-');
            if (!hasValidCookies) {
                log.warning('⚠️  Cookies appear to be template/placeholder, not actual cookies');
                log.warning('⚠️  Please export actual YouTube cookies from your browser');
            } else {
                log.info('✅ Cookies appear to be valid');
            }
        }

        // Step 4: Download video(s)
        log.info('⬇️  Starting video download...');
        const downloadCommandArgs = buildYtDlpCommandArgs(videoUrl, downloadDir, cookiesFile, detectedPlatform, poToken, proxyConfiguration, proxyUrl);
        log.info(`🚀 Running: yt-dlp ${downloadCommandArgs.join(' ')}`);

        try {
            await downloadWithProgressTracking(downloadCommandArgs, (progress) => {
                // Count downloaded videos based on yt-dlp output
                if (progress.includes('[download]')) {
                    const match = progress.match(/\[download\] Downloading video (\d+) of (\d+)/);
                    if (match) {
                        downloadedVideosCount = parseInt(match[1]);
                        log.info(`📊 Downloaded ${downloadedVideosCount} videos`);

                        // Check if we reached the limit
                        if (downloadedVideosCount >= MAX_VIDEOS_BEFORE_UPLOAD && !shouldStopDownload) {
                            shouldStopDownload = true;
                            log.info(`⚠️  Reached ${MAX_VIDEOS_BEFORE_UPLOAD} videos limit, will stop after current download`);
                        }
                    }
                }
            }, () => shouldStopDownload);

            log.info('✅ Video download completed');
        } catch (e) {
            if (shouldStopDownload) {
                log.info('🛑 Download stopped due to video limit');
            } else {
                log.error('❌ Video download failed');
                throw e;
            }
        }

        // Step 5: List downloaded files
        const downloadedFiles = fs.readdirSync(downloadDir);
        log.info(`📦 Downloaded ${downloadedFiles.length} file(s):`);
        downloadedFiles.forEach(file => {
            const filePath = path.join(downloadDir, file);
            const stats = fs.statSync(filePath);
            log.info(`   - ${file} (${formatBytes(stats.size)})`);
        });

        // Check if we hit the video limit
        const hitVideoLimit = downloadedVideosCount >= MAX_VIDEOS_BEFORE_UPLOAD;
        if (hitVideoLimit) {
            log.info(`⚠️  Hit video limit (${MAX_VIDEOS_BEFORE_UPLOAD}), will force upload to Drive`);
            // Force upload to Drive even if not originally requested
            if (!uploadToDrive) {
                log.info('🔄 Auto-enabling Drive upload due to video limit');
                // We'll use the Drive credentials if provided, otherwise warn
                if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
                    log.warning('⚠️  Drive credentials not provided, will skip upload');
                }
            }
        }

        // Step 6: Compress to ZIP
        const zipFile = path.join(tempDir, 'downloaded-video.zip');
        log.info('🗜️  Compressing files to ZIP...');
        
        try {
            execSync(`cd "${downloadDir}" && zip -r "${zipFile}" .`, { stdio: 'inherit' });
            log.info('✅ Files compressed successfully');
        } catch (e) {
            log.error('❌ Compression failed');
            throw e;
        }

        // Step 7: Read ZIP file and push to dataset
        const zipBuffer = fs.readFileSync(zipFile);
        const zipStats = fs.statSync(zipFile);
        log.info(`📊 ZIP file size: ${formatBytes(zipStats.size)}`);

        // Push results to dataset
        await Actor.pushData({
            videoUrl,
            platform: detectedPlatform,
            downloadedFiles,
            zipSize: zipStats.size,
            zipSizeFormatted: formatBytes(zipStats.size),
            success: true,
            timestamp: new Date().toISOString()
        });

        // Save ZIP file to Key-Value Store
        await Actor.setValue('downloaded-video.zip', zipBuffer, { contentType: 'application/zip' });
        log.info('💾 ZIP file saved to Key-Value Store');

        // Step 8: Upload to Google Drive if requested or if hit video limit
        const shouldUploadToDrive = uploadToDrive || hitVideoLimit;
        if (shouldUploadToDrive) {
            if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
                if (hitVideoLimit) {
                    log.warning('⚠️  Hit video limit but no Drive credentials provided - skipping upload');
                } else {
                    throw new Error('❌ Google Drive credentials are required for upload');
                }
            } else {
                log.info('☁️  Uploading to Google Drive...');
                await uploadToGoogleDrive(zipFile, driveFolderId, {
                    clientId: googleClientId,
                    clientSecret: googleClientSecret,
                    refreshToken: googleRefreshToken
                });
                log.info('✅ Successfully uploaded to Google Drive');

                // If we hit the video limit, exit after upload
                if (hitVideoLimit) {
                    log.info(`🎉 Process completed after ${MAX_VIDEOS_BEFORE_UPLOAD} videos`);
                    log.info('📤 Files uploaded to Drive and process stopped as requested');
                    await Actor.exit();
                    return;
                }
            }
        }

        log.info('🎉 Actor completed successfully!');

    } finally {
        // Cleanup
        log.info('🧹 Cleaning up temporary files...');
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            log.info('✅ Cleanup completed');
        } catch (e) {
            log.warning('⚠️  Cleanup failed (may be safe to ignore)');
        }
    }

    await Actor.exit();
});

// Helper function to detect platform from URL
function detectPlatform(url) {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
        return 'youtube';
    } else if (lowerUrl.includes('vimeo.com')) {
        return 'vimeo';
    } else if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch')) {
        return 'facebook';
    } else if (lowerUrl.includes('reddit.com')) {
        return 'reddit';
    } else if (lowerUrl.includes('tiktok.com')) {
        return 'tiktok';
    } else if (lowerUrl.includes('instagram.com')) {
        return 'instagram';
    }
    
    return 'unknown';
}

// Helper function to download with progress tracking and stop capability
function downloadWithProgressTracking(args, onProgress, shouldStopCallback) {
    return new Promise((resolve, reject) => {
        const ytDlpProcess = spawn('yt-dlp', args);

        ytDlpProcess.stdout.on('data', (data) => {
            const output = data.toString();
            log.info(output.trim());
            if (onProgress) {
                onProgress(output);
            }
        });

        ytDlpProcess.stderr.on('data', (data) => {
            const error = data.toString();
            // Some progress info comes through stderr in yt-dlp
            if (error.includes('[download]')) {
                log.info(error.trim());
                if (onProgress) {
                    onProgress(error);
                }
            } else {
                log.error(error.trim());
            }
        });

        ytDlpProcess.on('close', (code) => {
            if (code === 0 || shouldStopCallback && shouldStopCallback()) {
                resolve();
            } else {
                reject(new Error(`yt-dlp process exited with code ${code}`));
            }
        });

        // Check periodically if we should stop
        const checkInterval = setInterval(() => {
            if (shouldStopCallback && shouldStopCallback()) {
                log.info('🛑 Stopping download process...');
                ytDlpProcess.kill('SIGTERM');
                clearInterval(checkInterval);
            }
        }, 1000);
    });
}

// Helper function to build yt-dlp command arguments
function buildYtDlpCommandArgs(url, outputDir, cookiesFile, platform, poToken, proxyConfiguration, proxyUrl) {
    const args = [
        '--output', `${outputDir}/%(title)s.%(ext)s`,
        '--newline',
        '--no-warnings'
    ];

    if (cookiesFile) {
        args.push('--cookies', cookiesFile);
    }

    // Add PO Token for YouTube if provided
    if (poToken && platform === 'youtube') {
        args.push('--extractor-args', `youtube:po_token=${poToken}`);
    }

    // Add proxy if configured
    if (proxyUrl) {
        args.push('--proxy', proxyUrl);
        log.info(`🌐 Using Apify Proxy: ${proxyUrl}`);
    } else if (proxyConfiguration?.proxyUrls && proxyConfiguration.proxyUrls.length > 0) {
        args.push('--proxy', proxyConfiguration.proxyUrls[0]);
        log.info(`🌐 Using custom proxy: ${proxyConfiguration.proxyUrls[0]}`);
    }

    // Add platform-specific options
    if (platform === 'facebook') {
        args.push('--extractor-args', 'facebook:username=auto');
    }

    // Add user agent
    args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Add ignore errors
    args.push('--ignore-errors');

    // Add no-check-certificate and socket timeout for proxy SSL issues
    if (proxyUrl || (proxyConfiguration?.proxyUrls && proxyConfiguration.proxyUrls.length > 0)) {
        args.push('--no-check-certificate');
        args.push('--socket-timeout', '60');
        log.info('🔓 SSL certificate verification disabled for proxy');
        log.info('⏱️  Socket timeout increased to 60 seconds');
    }

    args.push(url);

    return args;
}

// Helper function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to upload to Google Drive
async function uploadToGoogleDrive(zipFilePath, folderId, credentials) {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
        const pythonScript = `
import io
import json
import mimetypes
import os
import sys

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

zip_file_path, folder_id, client_id, client_secret, refresh_token = sys.argv[1:]

credentials_data = {
    "client_id": client_id,
    "client_secret": client_secret,
    "refresh_token": refresh_token,
    "token_uri": "https://oauth2.googleapis.com/token"
}

credentials = Credentials(
    token=None,
    refresh_token=credentials_data["refresh_token"],
    token_uri=credentials_data.get("token_uri", "https://oauth2.googleapis.com/token"),
    client_id=credentials_data["client_id"],
    client_secret=credentials_data["client_secret"],
    scopes=["https://www.googleapis.com/auth/drive.file"],
)

drive = build("drive", "v3", credentials=credentials)

target_zip = os.path.basename(zip_file_path)
metadata = {"name": target_zip}
if folder_id:
    metadata["parents"] = [folder_id]

media = MediaFileUpload(
    zip_file_path,
    mimetype=mimetypes.guess_type(zip_file_path)[0] or "application/zip",
    resumable=True,
)

query = f"name = {json.dumps(target_zip)} and trashed = false"
if folder_id:
    query += f" and {json.dumps(folder_id)} in parents"

existing = drive.files().list(
    q=query,
    spaces="drive",
    pageSize=1,
    fields="files(id,name)",
).execute().get("files", [])

if existing:
    # When updating existing file, don't include parents in metadata
    update_metadata = {"name": target_zip}
    result = drive.files().update(
        fileId=existing[0]["id"],
        body=update_metadata,
        media_body=media,
        fields="id,name",
    ).execute()
    print(f"Updated {target_zip} -> {result['name']} ({result['id']})")
else:
    result = drive.files().create(body=metadata, media_body=media, fields="id,name").execute()
    print(f"Created {target_zip} -> {result['name']} ({result['id']})")
`;

        const tempScriptPath = path.join(os.tmpdir(), 'drive_upload_' + Date.now() + '.py');
        fs.writeFileSync(tempScriptPath, pythonScript);

        const pythonProcess = spawn('python3', [
            tempScriptPath,
            zipFilePath,
            folderId || '',
            credentials.clientId,
            credentials.clientSecret,
            credentials.refreshToken
        ]);

        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
            log.info(`📤 Drive API: ${data.toString().trim()}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
            log.error(`❌ Drive Error: ${data.toString().trim()}`);
        });

        pythonProcess.on('close', (code) => {
            // Clean up temp script
            try {
                fs.unlinkSync(tempScriptPath);
            } catch (e) {
                // Ignore cleanup errors
            }

            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(`Python script failed with code ${code}: ${errorOutput}`));
            }
        });
    });
}
