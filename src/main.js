import { Actor, log } from 'apify';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Main Actor function
Actor.main(async () => {
    await Actor.init();

    log.info('🎬 Video Downloader Actor started');

    // Get input from the user
    const input = await Actor.getInput();
    const { 
        videoUrl, 
        cookies, 
        platform = 'auto',
        uploadToDrive = false,
        driveFolderId = '',
        googleClientId = '',
        googleClientSecret = '',
        googleRefreshToken = ''
    } = input;

    if (!videoUrl) {
        throw new Error('❌ videoUrl is required');
    }

    log.info(`📥 Video URL: ${videoUrl}`);
    log.info(`🍪 Cookies provided: ${cookies ? 'Yes' : 'No'}`);
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
        }

        // Step 4: Download video
        log.info('⬇️  Starting video download...');
        const downloadCommand = buildYtDlpCommand(videoUrl, downloadDir, cookiesFile, detectedPlatform);
        log.info(`🚀 Running: ${downloadCommand}`);
        
        try {
            execSync(downloadCommand, { stdio: 'inherit' });
            log.info('✅ Video downloaded successfully');
        } catch (e) {
            log.error('❌ Video download failed');
            throw e;
        }

        // Step 5: List downloaded files
        const downloadedFiles = fs.readdirSync(downloadDir);
        log.info(`📦 Downloaded ${downloadedFiles.length} file(s):`);
        downloadedFiles.forEach(file => {
            const filePath = path.join(downloadDir, file);
            const stats = fs.statSync(filePath);
            log.info(`   - ${file} (${formatBytes(stats.size)})`);
        });

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

        // Step 8: Upload to Google Drive if requested
        if (uploadToDrive) {
            if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
                throw new Error('❌ Google Drive credentials are required for upload');
            }
            
            log.info('☁️  Uploading to Google Drive...');
            await uploadToGoogleDrive(zipFile, driveFolderId, {
                clientId: googleClientId,
                clientSecret: googleClientSecret,
                refreshToken: googleRefreshToken
            });
            log.info('✅ Successfully uploaded to Google Drive');
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

// Helper function to build yt-dlp command
function buildYtDlpCommand(url, outputDir, cookiesFile, platform) {
    let command = `yt-dlp --output "${outputDir}/%(title)s.%(ext)s"`;
    
    if (cookiesFile) {
        command += ` --cookies "${cookiesFile}"`;
    }
    
    // Add platform-specific options
    if (platform === 'facebook') {
        command += ' --extractor-args "facebook:username=auto"';
    }
    
    // Add user agent
    command += ' --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"';
    
    // Add ignore errors
    command += ' --ignore-errors';
    
    command += ` "${url}"`;
    
    return command;
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
    result = drive.files().update(
        fileId=existing[0]["id"],
        body=metadata,
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
