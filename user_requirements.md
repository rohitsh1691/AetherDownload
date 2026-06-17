# AetherDownload: User Requirements & Prompts

This document tracks all the user requests and requirements provided in chronological order during the development, debugging, and enhancement of the AetherDownload manager and browser integration extension.

---

## 📋 Chronological List of User Prompts

### 1. HLS Stream Video Playback Failures
* **Prompt 1**: `not working -- 2160p.av1.mp4.m3u8.ts`
* **Prompt 2**: `2160p.av1.mp4.m3u8.ts file is unsupported`
* **Prompt 3**: `same error file extension is incorrect and broken`
* **Context**: When grabbing HLS video streams using fragmented MP4 (fMP4) (e.g. from xHamster), they downloaded as broken 1KB `init-v1-a1.mp4` files or failed to play under a double-extension like `.m3u8.ts`.

### 2. Browser Extension Detection Delay
* **Prompt 4**: `check the screenshot its not able to capture the video D:\Movies\check\Screenshot 2026-05-29 121944.png`
* **Context**: The browser extension grabber panel got stuck on "Scanning stream qualities..." because Manifest V3 service worker delays caused it to miss page-load HLS playlist requests.

### 3. YouTube Download Query
* **Prompt 5**: `can it will work for youtube videos`
* **Context**: Question about YouTube video streaming download support.

### 4. Direct Browser Interception Integration
* **Prompt 6**: `can this tool download the normal file download also instead of the chrome auto download feature`
* **Prompt 7**: `its not downloading auto going to chrome downloader only`
* **Context**: Requesting that the local server and Chrome extension automatically intercept regular browser downloads (like zip, exe, rar, etc.) instead of letting Chrome download them natively.

### 5. SourceForge Interception Redirect Errors
* **Prompt 8**: `it has failed xampp download`
* **Prompt 9**: `check new error`
* **Prompt 10**: `same 302 error`
* **Context**: Intercepting XAMPP from SourceForge initially failed with HTTP `403 Forbidden` or `302 Found` errors. The `302` redirects returned by CDNs for parallel chunk requests were not followed by the download worker threads, causing download aborts.

### 6. Network Glitches & Chunk Stalling
* **Prompt 11**: `error chunk failed`
* **Context**: Standard range-based worker threads threw `Connection timed out` error when downloads encountered temporary CDN stalls or latency spikes, causing the entire download to abort immediately.

### 7. Fragmented MP4 (fMP4) Playback Failures
* **Prompt 12**: `file downloaded - C:\Users\rohit\Downloads\720p.av1.mp4.m3u8.ts and C:\Users\rohit\Downloads\1080p.av1.mp4.m3u8.ts are not playing`
* **Context**: Fragmented HLS MP4 files downloaded with incorrect extensions like `.m3u8.ts` and were unplayable because the initialization segments containing the codec metadata (`init-v1-a1.mp4`) were not being parsed or prepended.

### 8. Floating Grabber Panel Missing on Embedded Players
* **Prompt 13**: `check screenshot download option is not coming - D:\Movies\check\Screenshot 2026-05-29 143158.png`
* **Context**: The floating "Download this video" button from the extension was not displaying on pages where the video player was loaded inside an iframe (subframe) or inside a custom Shadow DOM component.

### 9. Automatic Filename Collision Incrementor
* **Prompt 14**: `every time it should download with same name or increment value`
* **Context**: If a file with the target filename already exists in the destination downloads directory, AetherDownload should automatically increment the name (e.g. `video.mp4` -> `video (1).mp4` -> `video (2).mp4`) rather than silently overwriting the existing file.

### 10. Unsupported Format / Premature Compilation Cleanup
* **Prompt 15**: `it started downloading unsuported format`
* **Context**: Due to asynchronous write operations in the segment compilation process, the temporary directory was deleted and the download was marked completed before all data was flushed to disk. This resulted in truncated files that players rejected as having an unsupported format. Additionally, video files were being named generic names like `1080p.av1.mp4` or `.ts` without descriptive titles.

### 11. Delete All Option
* **Prompt 16**: `add delete all option`
* **Context**: The user requested a bulk delete button in the downloads interface to pause and clear all downloads along with their temporary directories from disk.

### 12. Documentation Verification
* **Prompt 17**: `are the docs updated`
* **Context**: The user requested validation that all project requirements, implemented features, issues/resolutions logs, and workspace documentation are complete, accurate, and up to date.

### 13. Dynamic Save Location Interception & Configuration Option
* **Prompt 18**: `it should have option to ask download location and can be changable from settings.`
* **Context**: The user requested an option to toggle whether they should be prompted for a custom download location/filename for each download, along with settings integration.

### 14. Installer Executable Verification
* **Prompt 19**: `new exe  file created`
* **Context**: The user asked for confirmation that the new Electron application installer containing the latest changes was successfully generated and stored.

### 15. Final Review & Testing
* **Prompt 20**: `now it is production ready will check this`
* **Context**: The user signed off on the current implementation state, marking it as production-ready and preparing to run local manual verification tests.

### 16. Firefox Extension Compatibility
* **Prompt 21**: `not able to import extension to  firefox`
* **Context**: The user reported failure importing the extension into Firefox. This is due to missing browser settings in the manifest and service worker runtime errors.

### 17. Extension Console Errors & Unchecked Runtime Warnings
* **Prompt 22**: `chrome is showing some errors - background.js:370 (anonymous function), AetherDownload unreachable. TypeError: Failed to fetch... Unchecked runtime.lastError: Download must be in progress`
* **Context**: The user reported two errors in the Chrome extension console. One was a fetch fallback log when the Aether manager is unreachable, and the other was an unchecked runtime error when trying to cancel a download before it starts.
