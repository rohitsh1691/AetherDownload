# AetherDownload: Issues Faced & Resolutions

This document provides a detailed log of the issues encountered during development and debugging of the AetherDownload manager and browser extension, along with their respective technical resolutions.

---

## 🛠️ Summary of Issues & Resolutions

### 1. HLS Fragmented MP4 (fMP4) Playback Failures
* **Issue**: 
  Video files downloaded from HLS streams utilizing fMP4 containers (like xHamster) were unplayable. The files lacked codec metadata because the initialization segment containing headers (e.g. `init-v1-a1.mp4`) was skipped. Additionally, compiled HLS files wrongly defaulted to the `.ts` extension (e.g., `720p.av1.mp4.m3u8.ts`), and the browser extension intercepted raw `init-` chunks as separate 1KB files.
* **Resolution**:
  * Added code in [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to parse HLS playlists for the `#EXT-X-MAP:URI="..."` header. It downloads this initialization chunk as segment `0` and prepends it to the stitched files during final compilation.
  * Extracted HLS container configurations to assign the `.mp4` extension if `usesFmp4` is true, avoiding double extensions.
  * Added rules in [background.js](file:///D:/Movies/check/extension/background.js) to ignore direct downloads of `init-` segments so they aren't captured as separate downloads.

---

### 2. Manifest V3 quality dropdown stuck on "Scanning..."
* **Issue**:
  The floating grabber panel got stuck scanning qualities because Manifest V3 service worker startup delays caused it to miss the page's original HLS playlist network requests.
* **Resolution**:
  * Implemented an on-demand playlist reconstruction mechanism in [background.js](file:///D:/Movies/check/extension/background.js).
  * If the extension intercepts an fMP4 initialization segment (`init-`), it dynamically parses the request URL to reconstruct the parent `.m3u8` playlist URL, fetches the manifest, parses its qualities, and immediately populates the quality dropdown.

---

### 3. Native Browser Interception Bypass and Redirect (302/403) Errors
* **Issue**:
  Chrome's native downloads were bypassable, and downloads of files like XAMPP from SourceForge aborted immediately with HTTP `403 Forbidden` or `302 Found` errors. This happened because referrers, User-Agents, and cookies were missing, or because parallel download workers could not follow redirect chains returned by CDN mirrors.
* **Resolution**:
  * Migrated the extension listener in [background.js](file:///D:/Movies/check/extension/background.js) from `chrome.downloads.onCreated` to `chrome.downloads.onDeterminingFilename` to reliably halt Chrome's native downloader.
  * Forwarded cookies, page referrer, and native browser User-Agent headers to the Electron backend.
  * Updated `makeRequest` inside [downloadWorker.ts](file:///D:/Movies/check/src/main/downloadWorker.ts) and handshake methods in [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to follow redirects (`301`/`302`/`307`/`308`) recursively on a per-connection basis.

---

### 4. Rigid Stalled Chunk & Network Timeout Crashes
* **Issue**:
  Download worker threads aborted immediately on standard network glitches, packet loss, or server latency spikes (e.g., `Connection timed out` after 15 seconds), failing the entire download.
* **Resolution**:
  * Integrated an automatic retry engine with exponential backoff (up to 5 attempts) in [downloadWorker.ts](file:///D:/Movies/check/src/main/downloadWorker.ts).
  * On retry, standard range connections calculate boundaries to fetch only the remaining missing bytes.
  * Non-range streams close and truncate the target file descriptor back to 0, decrementing in-memory progress to cleanly restart the download without file corruption.

---

### 5. Floating Grabber Panel Missing on Embedded Player Widgets
* **Issue**:
  The floating "Download this video" panel did not render on pages that embedded video elements inside iframes (subframes) or used shadow roots (Shadow DOM components) like YouTube and xHamster.
* **Resolution**:
  * Enabled `"all_frames": true` in [manifest.json](file:///D:/Movies/check/extension/manifest.json) content scripts configuration to force scripts injection into embedded player sub-contexts.
  * Implemented a recursive `findVideos` shadow boundary scanning helper inside [content.js](file:///D:/Movies/check/extension/content.js) to locate video elements nested behind `#shadow-root` tags.

---

### 6. Concurrent Filename SavePath Overwrite Collision
* **Issue**:
  Queueing multiple downloads at the same time assigned identical filenames and save paths (e.g., `1080p.av1.mp4`), causing them to overwrite each other since files weren't created on disk yet.
* **Resolution**:
  * Enhanced `getUniqueSavePath` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to scan both the filesystem (using `fs.existsSync`) and active database downloads (`downloads.some` filtering out completed and failed downloads unless the file is physically present on disk). This ensures unique paths are allocated before write streams open, without causing unnecessary renaming when a completed download is deleted from disk.

---

### 7. Generic Video Stream Filenames
* **Issue**:
  Intercepted HLS streams downloaded under generic URL-based names like `720p.av1.mp4` rather than descriptive video or page titles.
* **Resolution**:
  * Updated [content.js](file:///D:/Movies/check/extension/content.js) to pass the video page's tab title along with the TRIGGER_DESKTOP_DOWNLOAD message.
  * Updated the desktop server routes in [server.ts](file:///D:/Movies/check/src/main/server.ts) and engine [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to sanitize titles and resolve extensions accordingly.

---

### 8. Asynchronous Stream Synchronization during Compilation
* **Issue**:
  Video files sometimes compiled incomplete or corrupted because the compilation routine closed and deleted temporary segment directories before the operating system flushed the write stream buffers.
* **Resolution**:
  * Restructured `compileHlsSegments` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to return a Promise that resolves only after the destination write stream emits its `'finish'` event, guaranteeing a fully written and valid container file on disk before cleanups.

---

### 9. Lack of Bulk Deletion Action (Delete All)
* **Issue**:
  The user requested an option to delete all downloads at once instead of removing them one by one. Bulk deletion requires cleanly pausing active downloads and wiping the corresponding databases and disk-based temporary chunks directories to prevent resource leaks.
* **Resolution**:
  * Added `deleteAllDownloads()` in [engine.ts](file:///D:/Movies/check/src/main/engine.ts) to safely terminate connections and clear database states recurse-wise, which triggers cascading cleanups of temporary folders.
  * Connected IPC routing in [main.ts](file:///D:/Movies/check/src/main/main.ts), preload invoker in [preload.ts](file:///D:/Movies/check/src/preload/preload.ts), and rendered a red **Delete All** toolbar action in [App.tsx](file:///D:/Movies/check/src/renderer/App.tsx).

---

### 10. Missing Workspace Documentation
* **Issue**:
  The user requested user requirements, implementation details, and issues/resolutions lists. While these were created as AppData artifacts, the main project workspace did not contain all of them (only `issues_and_resolutions.md` was present in `D:\Movies\check`), making them less accessible to the user.
* **Resolution**:
  * Synced and wrote the complete [user_requirements.md](file:///D:/Movies/check/user_requirements.md) and [implemented_features.md](file:///D:/Movies/check/implemented_features.md) directly into the root workspace folder `D:\Movies\check`.
  * Updated all references to point correctly to local workspace file links.

---

### 11. TypeScript Implicit 'any' Compilation Error on Dynamic Imports
* **Issue**:
  When introducing dynamic imports for `dialog` and `BrowserWindow` via `require('electron')` inside [server.ts](file:///D:/Movies/check/src/main/server.ts), the TypeScript compiler threw error `TS7006: Parameter 'w' implicitly has an 'any' type` on the window filter search (`windows.find(w => !w.isDestroyed())`). Additionally, passing `undefined` conditionally in `dialog.showSaveDialog(mainWindow || undefined)` failed overload checks.
* **Resolution**:
  * Moved `dialog` and `BrowserWindow` imports to the top of the file as ESM modules to ensure strong type definitions are automatically resolved by the compiler.
  * Restructured the `showSaveDialog` execution into a conditional ternary statement to safely evaluate based on `mainWindow` existence without violating strict parameter types.

---

### 12. Firefox Extension Import Failure & Background Script Crashes
* **Issue**:
  Mozilla Firefox failed to import the Manifest V3 integration extension folder, reporting that service workers could not be registered without an addon ID. Once loaded, the background service worker crashed with a TypeError because `chrome.downloads.onDeterminingFilename` (a Chrome-exclusive API) is `undefined` on Firefox, preventing the extension from listening to any events.
* **Resolution**:
  * **Separate Build Directory**: Created a dedicated `extension-firefox/` folder generated dynamically by `scripts/build-firefox-ext.js`. This directory has `"service_worker"` completely removed from `manifest.json`'s `"background"` object, and contains only `"scripts": ["background.js"]` (as Firefox strictly rejects manifests that include the `"service_worker"` key).
  * **Gecko Extension ID configuration**: Added `browser_specific_settings` block to the manifest specifying a unique Gecko Extension ID `aetherdownload-integration@aether.manager`. This authorizes service workers/background extensions in Firefox.
  * **Guarded API Listeners**: Guarded the `onDeterminingFilename` listener in `background.js` to run only if the API is defined, preventing TypeError crashes on Firefox.
  * **Firefox Download Interception Fallback**: Implemented an `onCreated` download event handler inside the fallback block in `background.js` to cancel Firefox downloads and forward them to the Aether client.
