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
