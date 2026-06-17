# AetherDownload: Implemented Features

This document provides a detailed overview of the architectural changes, feature implementations, and bug fixes applied to the AetherDownload desktop manager and Manifest V3 Chrome extension.

---

## 🛠️ Summary of Implementations

### 1. HLS Fragmented MP4 (fMP4) Playback Fix
* **Feature**: Added support for downloading and compiling HLS fMP4 video streams.
* **Details**:
  * **Initialization Segment Prepended**: Updated the HLS manifest parser in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L229-L244) to look for the `#EXT-X-MAP:URI="..."` header, download the initialization segment (e.g. `init-v1-a1.mp4`), and register it as segment `0`. It is then prepended to the media chunks during HLS compiler stitching, allowing media players to decode and play the file.
  * **Automatic Extension Management**: Prevents double extensions like `.m3u8.ts` or `.mp4.mp4` by checking for the fMP4 format and changing the compiled video filename to `.mp4` instead of defaulting to Transport Stream `.ts`.
  * **Init-Segment Suppression**: Updated the network interceptor in [background.js](file:///D:/Movies/check/extension/background.js#L95-L106) to ignore direct downloads of `init-` chunks, preventing users from receiving broken 1KB files.

### 2. Manifest V3 Service Worker Delay Fallback
* **Feature**: Solved stream quality grabber panel getting stuck on "Scanning stream qualities...".
* **Details**:
  * **On-Demand Playlist Reconstruction**: When Manifest V3 service workers start up with a delay and miss page-load HLS playlists, intercepting any `init-` segment automatically triggers background reconstruction of the parent `.m3u8` URL in [background.js](file:///D:/Movies/check/extension/background.js#L93-L101).
  * The background worker fetches the manifest, parses the qualities, and populates the extension panel immediately.
  * Wrapped tab fetches in `try-catch` blocks and handled `chrome.runtime.lastError` to protect background thread runtime.

### 3. Automatic Browser Download Interception
* **Feature**: Seamless interception of native browser downloads.
* **Details**:
  * **Sniffing Event Migration**: Migrated download sniffing in [background.js](file:///D:/Movies/check/extension/background.js#L34-L53) from `chrome.downloads.onCreated` to `chrome.downloads.onDeterminingFilename` to reliably cancel Chrome's native download process and trigger Aether instead.
  * **Referrer and User-Agent Forwarding**: Captured the browser's native `navigator.userAgent` and the page Referrer, forwarding them to Aether via the REST API to bypass security blocks (like SourceForge `403 Forbidden`).
  * **URL Expired-Token Bypass**: Changed the extension API call in [background.js](file:///D:/Movies/check/extension/background.js#L74) to send the fully resolved `finalUrl` (mirror CDN URL followed by Chrome) instead of the original `url` to bypass expired timestamp token redirects.

### 4. Automatic Redirect Handling
* **Feature**: Standardized redirect following across handshakes and workers.
* **Details**:
  * **Handshake Redirects**: Updated the server handshake methods in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L624-L628) and [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L684-L689) to follow redirects (`301`/`302`) dynamically and fall back to GET range requests for mirror CDNs that reject HEAD requests.
  * **Worker Thread Redirects**: Wrapped the HTTP/HTTPS request module inside [downloadWorker.ts](file:///D:/Movies/check/src/main/downloadWorker.ts#L93-L110) in a recursive `makeRequest` helper function, allowing parallel download workers to follow `3xx` redirects dynamically on a per-chunk basis.

### 5. Robust Chunk Retry Engine
* **Feature**: Stalled chunk recovery and network glitch resilience.
* **Details**:
  * **Exponential Backoff Retries**: Integrated an automatic retry mechanism (up to 5 attempts) in [downloadWorker.ts](file:///D:/Movies/check/src/main/downloadWorker.ts#L201-L215) for handle timeouts (`15000ms`), connection drops, and resets.
  * **Dynamic Range Recovery**: On standard worker retries, the Range header is recalculated dynamically to request only the remaining missing bytes of that chunk, preserving progress.
  * **Non-Range Stream Resetting**: For non-range streams, retrying closes and truncates the file descriptor back to 0, subtracts the failed progress from the main thread database dynamically, and restarts from scratch to avoid file corruption.

### 6. Process Conflict Resolution
* **Feature**: Multi-instance port conflict handling.
* **Details**:
  * Cleaned up background packaged processes of `AetherDownload.exe` that bound port `9654` and blocked development server responses.
  * Configured Electron to launch cleanly in development mode (`npm run dev`) with watch-mode TS builds.

### 7. Floating Grabber Panel on Iframes & Shadow DOMs
* **Feature**: Added comprehensive video player detection in subframes (iframes) and shadow DOMs.
* **Details**:
  * **Iframe Injection Enabled**: Updated [manifest.json](file:///D:/Movies/check/extension/manifest.json#L24-L26) to include `"all_frames": true`. This forces the browser to inject the content scripts inside subframes/iframes where external video players are loaded.
  * **Recursive Shadow DOM Scanning**: Modified [content.js](file:///D:/Movies/check/extension/content.js#L23-L42) to add a recursive `findVideos` function. This scans all elements on the page, checks if they have a `shadowRoot` (typical for web components or custom media players like YouTube's), and traverses them to locate embedded `<video>` elements.
  * **Appended floating button in Sub-Contexts**: When running inside an iframe, the floating download panel is appended to the iframe's body element and positioned correctly inside the iframe's boundaries.

### 8. Automatic Filename Collision Incrementor
* **Feature**: Added automatic duplicate filename renaming to prevent file overwrites.
* **Details**:
  * **getUniqueSavePath Helper**: Added the `getUniqueSavePath` helper method to [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L821-L837). This checks if the target save file path exists on disk, and recursively increments a counter to append ` (1)`, ` (2)`, etc. (e.g. `document (1).pdf`) until a free filename is found.
  * **Queue Integration**: Integrates this renaming check inside `addDownload` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L66-L70) when initially adding/registering a new download.
  * **Post-Handshake Override Integration**: Applied the check inside `startStandardDownload` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L130-L134) for cases where server response metadata overrides the initial filename.
  * **HLS Format Conversion Integration**: Applied the check inside `startHlsDownload` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L263-L267) when converting HLS fMP4 formats to standard `.mp4` extensions.

### 9. Title-Based Grabber Filename Resolution
* **Feature**: Video stream downloads are named using the web page title rather than generic URL names (e.g. `720p.av1.mp4`).
* **Details**:
  * Updated [background.js](file:///D:/Movies/check/extension/background.js#L261-L276) and [content.js](file:///D:/Movies/check/extension/content.js#L135-L143) to capture and pass the tab's page title with intercepted streams when triggering downloads.
  * Extracted the `title` in [server.ts](file:///D:/Movies/check/src/main/server.ts#L45-L48) and forwarded it to the download engine.
  * Modified the download engine in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L38-L58) to sanitize the title and use it as the base filename, resolving extension collisions by appending extensions from the URL.

### 10. In-Memory SavePath Collision Prevention
* **Feature**: Collision checks prevent assigning the same file path to concurrent active/queued downloads.
* **Details**:
  * Enhanced `getUniqueSavePath` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L826-L840) to scan both the filesystem (using `fs.existsSync`) and the active/queued downloads database (using `downloads.some`), preventing concurrent downloads from silently overwriting each other.

### 11. Stream Write Synchronization during HLS Concatenation
* **Feature**: Fixed files showing up as "unsupported format" or corrupted due to premature cleanup during chunk compilation.
* **Details**:
  * In [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L493-L528), restructured `compileHlsSegments` to return a Promise that resolves only when the file's `WriteStream` emits the `'finish'` event. This guarantees all video frames are completely flushed and written to disk before the app deletes the temporary directory and updates the download status to completed.

### 12. Delete All Option
* **Feature**: Added a "Delete All" button in the global toolbar to bulk delete download logs.
* **Details**:
  * Added `deleteAllDownloads` method inside [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to pause any active downloads, delete their database records, and automatically clean up their temporary folders from disk.
  * Registered IPC handler `download:delete-all` inside [main.ts](file:///D:/Movies/check/src/main/main.ts) and exposed it via [preload.ts](file:///D:/Movies/check/src/preload/preload.ts).
  * Rendered the "Delete All" button in [App.tsx](file:///D:/Movies/check/src/renderer/App.tsx) next to "Pause All". Clicking it prompts for confirmation before bulk deletion.

### 13. Documentation Synchronization
* **Feature**: Maintained and synchronized user requirements, implementation history, and resolution tracking.
* **Details**:
  * Created and maintained [user_requirements.md](file:///D:/Movies/check/user_requirements.md) documenting chronological prompts.
  * Created and maintained [implemented_features.md](file:///D:/Movies/check/implemented_features.md) tracking all core architectural improvements.
  * Created and maintained [issues_and_resolutions.md](file:///D:/Movies/check/issues_and_resolutions.md) documenting diagnostic details and solutions for developers/users.
  * Synchronized all documentation files directly into the workspace root ([D:/Movies/check](file:///D:/Movies/check)) for easy user visibility.

### 14. Configuration Option & Dialog Prompt for Custom Save Locations
* **Feature**: Configurable save location prompting for all download sources.
* **Details**:
  * **AppSettings Expansion**: Added the `askSaveLocation` boolean flag to settings schema in [types.ts](file:///D:/Movies/check/src/shared/types.ts#L41) (defaulting to `false`).
  * **Database Defaults**: Mapped the default value of `askSaveLocation` in [db.ts](file:///D:/Movies/check/src/main/db.ts#L97).
  * **Engine Adaptability**: Modified `addDownload` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts#L38-L101) to support an `exactFilePath` parameter, bypassing automatic filename incrementation checks if a path was already selected by the user.
  * **Save File Dialog IPC**: Added the `shell:select-save-path` bridge channel in [main.ts](file:///D:/Movies/check/src/main/main.ts#L216-L227) and [preload.ts](file:///D:/Movies/check/src/preload/preload.ts#L34) wrapping Electron's native `dialog.showSaveDialog`.
  * **Dashboard Integrations**: Integrated the save dialog in [App.tsx](file:///D:/Movies/check/src/renderer/App.tsx#L210-L244) during standard dashboard additions, and inside the Media Grabber's `handleDownload` stream triggers.
  * **Interception Server Promotion**: Configured the POST `/download` intercept route in [server.ts](file:///D:/Movies/check/src/main/server.ts#L86-L108) to bring the hidden/minimized main Electron window to focus and display the native save file dialog before registering a grabbed download if the user enabled the `askSaveLocation` switch.
  * **UI Toggle Configuration**: Added a checkbox in [App.tsx](file:///D:/Movies/check/src/renderer/App.tsx#L1200-L1212) under general settings.

### 15. Firefox Extension Compatibility Enhancement
* **Feature**: Support importing and running the extension inside Mozilla Firefox.
* **Details**:
  * **Folder Separation & Auto-Sync**: Designed separate browser targets to resolve the strict rejection of `service_worker` by Firefox's Manifest V3 validation parser. The default `extension/` folder is tailored for Chrome/Edge (utilizing `"service_worker"`), and a new build script `scripts/build-firefox-ext.js` dynamically compiles/syncs changes into an `extension-firefox/` directory designed for Firefox (utilizing `"scripts"` only, removing `"service_worker"`).
  * **Gecko Extension ID configuration**: Added `"browser_specific_settings"` to `manifest.json` defining `aetherdownload-integration@aether.manager` as the addon ID.
  * **TypeError Guarding**: Guarded `chrome.downloads.onDeterminingFilename` in `background.js` to prevent background script crashes due to missing properties on Firefox.
  * **Firefox Download Interception Fallback**: Integrated a fallback listener on `chrome.downloads.onCreated` in `background.js` for Firefox, safely canceling native browser downloads and sending them to the Aether desktop engine.

### 16. Extension Runtime Error Guards & Error Handling
* **Feature**: Suppressed runtime console warnings and unchecked lastError exceptions in the browser extension.
* **Details**:
  * **Unchecked lastError Prevention**: Wrapped the `chrome.downloads.cancel` and `chrome.downloads.erase` callbacks in [background.js](file:///D:/Movies/check/extension/background.js#L68-L76) (both for Chrome/Edge and the Firefox fallback block) in error-checking routines that query `chrome.runtime.lastError`. This prevents the browser from logging "Unchecked runtime.lastError: Download must be in progress" when requests are cancelled before completion.
