# AetherDownload: Browser Extension Installation Guide

This guide provides instructions on how to install and load the AetherDownload integration extension in Google Chrome, Microsoft Edge, and Mozilla Firefox.

---

## 🌐 Google Chrome & Microsoft Edge

### 📂 Location
* **Folder Path**: `D:\Movies\check\extension\`

### 🛠️ Installation Steps
1. Open Google Chrome or Microsoft Edge.
2. Navigate to the Extensions management page:
   * **Chrome**: Open `chrome://extensions/`
   * **Edge**: Open `edge://extensions/`
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left corner.
5. In the file picker, select the **`extension`** folder:
   `D:\Movies\check\extension\`
6. The extension is now loaded and will automatically intercept downloads.

---

## 🦊 Mozilla Firefox

### 📂 Location
* **Folder Path**: `D:\Movies\check\extension-firefox\`
* *Note: This folder is automatically generated and updated by the build pipeline to comply with Firefox's Manifest V3 requirements.*

### 🛠️ Installation Steps
1. Open Mozilla Firefox.
2. In the address bar, type **`about:debugging`** and press **Enter**.
3. Click on **This Firefox** in the left-hand sidebar.
4. Click the **Load Temporary Add-on...** button.
5. In the file explorer, navigate to the **`extension-firefox`** folder:
   `D:\Movies\check\extension-firefox\`
6. Select the **`manifest.json`** file and click **Open**.
7. Ensure localhost permissions are granted:
   * Go to **`about:addons`**.
   * Click on the **AetherDownload Integration Module**.
   * Go to the **Permissions** tab and verify that access to loopback/localhost is toggled **ON**.

---

## ⚡ Extension Synchronization (For Developers)
The main codebase for the extension is in `extension/`. The Firefox version `extension-firefox/` is compiled and synchronized automatically whenever you run the project.

If you make modifications to the extension scripts:
* Running `npm run dev` or `npm run build` will automatically update the Firefox extension target.
* Alternatively, run the sync script manually from the command line:
  ```bash
  node scripts/build-firefox-ext.js
  ```
* After compiling changes, remember to click **Reload** under the extension in your browser's Developer/Debugging interface.
