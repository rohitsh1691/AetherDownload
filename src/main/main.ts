import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from './db';
import { DownloadEngine } from './engine';
import { IntegrationServer } from './server';
import { SchedulerService } from './scheduler';
import { AppSettings, MediaStreamInfo } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

let db: DatabaseService;
let engine: DownloadEngine;
let server: IntegrationServer;
let scheduler: SchedulerService;

function createDefaultIconIfMissing() {
  const iconPath = path.join(app.getPath('userData'), 'drag_icon.png');
  if (!fs.existsSync(iconPath)) {
    // Generate a simple 1x1 transparent PNG buffer
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    fs.writeFileSync(iconPath, Buffer.from(base64Png, 'base64'));
  }
  return iconPath;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: true,
    title: 'AetherDownload',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load front-end from dev server or static build
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Use user data folder drag icon as tray placeholder to avoid crashing if empty
  const trayIcon = createDefaultIconIfMissing();
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open AetherDownload',
      click: () => {
        mainWindow?.show();
      }
    },
    {
      label: 'Pause All',
      click: () => {
        const downloads = db.getDownloads();
        downloads.forEach(d => {
          if (d.status === 'downloading') engine.pauseDownload(d.id);
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AetherDownload - High Speed Downloader');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

app.whenReady().then(() => {
  // Initialize Database
  db = new DatabaseService();

  // Initialize Engine
  engine = new DownloadEngine(db, (item) => {
    // Notify Renderer of download progress updates
    if (mainWindow) {
      mainWindow.webContents.send('download:progress', item);
    }
  });

  // Initialize Local Server for Browser Extension
  server = new IntegrationServer(engine, (media: MediaStreamInfo) => {
    // Notify Renderer of media stream detection
    if (mainWindow) {
      mainWindow.webContents.send('media:detected', media);
    }
  });

  // Initialize Scheduler
  scheduler = new SchedulerService(db, engine);

  // Set startup launch state based on config
  const settings = db.getSettings();
  app.setLoginItemSettings({
    openAtLogin: settings.general.launchOnStart,
    path: app.getPath('exe'),
  });

  createWindow();
  createTray();

  // Register IPC Handlers
  registerIpcHandlers();
});

function registerIpcHandlers() {
  // Database handlers
  ipcMain.handle('db:get-settings', () => db.getSettings());
  ipcMain.handle('db:save-settings', (_event, settings: AppSettings) => {
    db.saveSettings(settings);
    // Update startup settings
    app.setLoginItemSettings({
      openAtLogin: settings.general.launchOnStart,
      path: app.getPath('exe'),
    });
  });
  ipcMain.handle('db:get-downloads', () => db.getDownloads());

  // Download control handlers
  ipcMain.handle('download:add', async (_event, url: string, customPath?: string, headers?: Record<string, string>, title?: string, exactFilePath?: string) => {
    return await engine.addDownload(url, customPath, headers, title, exactFilePath);
  });
  ipcMain.handle('download:start', async (_event, id: string) => {
    await engine.startDownload(id);
  });
  ipcMain.handle('download:pause', (_event, id: string) => {
    engine.pauseDownload(id);
  });
  ipcMain.handle('download:delete', (_event, id: string) => {
    db.deleteDownload(id);
  });
  ipcMain.handle('download:delete-all', () => {
    engine.deleteAllDownloads();
  });

  // Media detection handlers
  ipcMain.handle('media:get-detected', () => server.getDetectedMedia());
  ipcMain.handle('media:clear', () => server.clearDetectedMedia());

  // Shell operations
  ipcMain.handle('shell:open-file', async (_event, filePath: string) => {
    if (fs.existsSync(filePath)) {
      const err = await shell.openPath(filePath);
      return err === '';
    }
    return false;
  });

  ipcMain.handle('shell:open-folder', async (_event, filePath: string) => {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    } else {
      // If file doesn't exist, open containing directory if it does
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        await shell.openPath(dir);
        return true;
      }
    }
    return false;
  });

  ipcMain.handle('shell:select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('shell:select-save-path', async (_event, defaultPath: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath,
      properties: ['showOverwriteConfirmation'],
    });
    if (!result.canceled && result.filePath) {
      return result.filePath;
    }
    return null;
  });

  // Native drag start handler
  ipcMain.on('drag:start', (event, id: string) => {
    const downloads = db.getDownloads();
    const item = downloads.find(d => d.id === id);
    if (item && item.status === 'completed' && fs.existsSync(item.savePath)) {
      const dragIcon = createDefaultIconIfMissing();
      event.sender.startDrag({
        file: item.savePath,
        icon: dragIcon,
      });
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (server) server.close();
  if (scheduler) scheduler.stop();
});
