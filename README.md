# 🚀 AetherDownload

AetherDownload is a modern, premium, high-performance internet download manager and browser integration suite. Designed as a sleek, developer-friendly, and open-source alternative to traditional download managers like Internet Download Manager (IDM), it features multi-threaded segment downloading, real-time browser interception, and streaming media grabbing.

---

## 🌟 Key Features

* **⚡ Multi-Threaded Acceleration**: Dynamically segments files and downloads them in up to 32 parallel worker threads, maximizing bandwidth utilization.
* **🛡️ Stalled Chunk & Network Recovery**: Built-in retry engine with exponential backoff that automatically resumes stalled chunk connections without failing the entire download.
* **🎥 Advanced HLS / m3u8 Grabber**: Detects, parses, and downloads fragmented HLS video streams (including fMP4 containers), automatically stitching media initialization descriptors for seamless playback.
* **🌐 Browser Interception**: Intercepts native downloads in real-time across Google Chrome, Microsoft Edge, and Mozilla Firefox, forwarding them to the local server.
* **🔍 Deep Shadow DOM & Iframe Scanning**: Floating media grabber panels recursively query nested Shadow DOM boundaries and embedded iframes to capture embedded video elements.
* **📂 Collision Prevention**: Prevents file overwrites by scanning local directories and in-memory download queues, automatically generating unique names (e.g., `document (1).pdf`).
* **🎨 Modern Electron Dashboard**: Built with a sleek, premium UI using React, TypeScript, and TailwindCSS principles, complete with download tracking, pause/resume/delete actions, and configuration settings.

---

## 📥 Getting Started

To get started with AetherDownload, you will need to install both the **Desktop Downloader Application** and the **Browser Extension**.

### 1. Install the Desktop Downloader

#### 🚀 For General Users (Recommended)
Download the pre-compiled Windows installer directly:
* **[Download AetherDownload Setup 1.0.0.exe](https://github.com/rohitsh1691/AetherDownload/releases/download/v1.0.0/AetherDownload.Setup.1.0.0.exe)**
* Or visit the **[Releases Page](https://github.com/rohitsh1691/AetherDownload/releases)** for other versions.

#### 🛠️ For Developers (Building from Source)
Ensure you have [Node.js](https://nodejs.org/) installed, then follow these commands:

1. Clone or download the repository.
2. Open your terminal in the project directory and install the dependencies:
   ```bash
   npm install
   ```
3. Run the application in development mode:
   ```bash
   npm run dev
   ```
4. Build the production installer (`.exe` executable for Windows):
   ```bash
   npm run build
   ```
   *The installer will be generated in the **`dist-installer/`** folder.*

---

### 2. Install the Browser Integration Extension

The extension integrates Chrome, Edge, and Firefox with the desktop application. Detailed paths and settings can be found in the [Extension Installation Guide](file:///D:/Movies/check/extension_installation_guide.md).

#### 🌐 Google Chrome & Microsoft Edge (Chromium-based)
1. Open the Extensions management page (`chrome://extensions` or `edge://extensions`).
2. Toggle **Developer mode** (top-right corner) to **ON**.
3. Click the **Load unpacked** button.
4. Select the **`extension/`** folder inside the project directory.

#### 🦊 Mozilla Firefox
Firefox requires a specific manifest format that excludes Chromium's `service_worker`. A Firefox-compatible package is automatically generated under `extension-firefox/` during the build process.
1. Open Firefox and enter **`about:debugging`** in the address bar.
2. Click **This Firefox** on the left sidebar.
3. Click **Load Temporary Add-on...**
4. Select the **`manifest.json`** inside the **`extension-firefox/`** folder.
5. In **`about:addons`**, select the extension, go to the **Permissions** tab, and verify that localhost/loopback access is toggled **ON**.

---

## 🛠️ Architecture Overview

The system is split into two primary components:

* **Desktop Application (Electron, Node.js, TS, React)**:
  * **Main Process**: Initiates a local HTTP server on port `9654` to receive download requests from the browser, manages the download queue, database operations, and multi-threaded range connections.
  * **Renderer Process**: A React dashboard that provides controls for managing downloads, settings, and active download progress.
* **Browser Extension (Vanilla Javascript, CSS, HTML)**:
  * Intercepts browser requests, monitors network activity for streaming endpoints, and forwards files to the desktop client via local IPC / REST endpoints.

---

## 📄 Documentation

For developers interested in the evolution, issues, and core features of the system, please refer to:
* [User Requirements log](file:///D:/Movies/check/user_requirements.md)
* [Implemented Features & Changelog](file:///D:/Movies/check/implemented_features.md)
* [Issues Faced & Resolutions](file:///D:/Movies/check/issues_and_resolutions.md)
