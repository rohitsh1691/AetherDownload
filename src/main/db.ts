import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AppSettings, DownloadItem } from '../shared/types';

export class DatabaseService {
  private userDataPath: string;
  private settingsFile: string;
  private downloadsFile: string;
  private memorySettings!: AppSettings;
  private memoryDownloads: DownloadItem[] = [];

  constructor() {
    // Get the user data directory
    try {
      this.userDataPath = app.getPath('userData');
    } catch (e) {
      // Fallback for tests or local execution
      this.userDataPath = path.join(process.cwd(), '.aether_data');
    }

    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true });
    }

    this.settingsFile = path.join(this.userDataPath, 'settings.json');
    this.downloadsFile = path.join(this.userDataPath, 'downloads.json');

    this.initDatabase();
  }

  private initDatabase() {
    // Initialize Settings
    if (fs.existsSync(this.settingsFile)) {
      try {
        const raw = fs.readFileSync(this.settingsFile, 'utf8');
        this.memorySettings = JSON.parse(raw);
      } catch (e) {
        console.error('Failed to parse settings database, using defaults.', e);
        this.memorySettings = this.getDefaultSettings();
        this.saveSettings(this.memorySettings);
      }
    } else {
      this.memorySettings = this.getDefaultSettings();
      this.saveSettings(this.memorySettings);
    }

    // Initialize Downloads List
    if (fs.existsSync(this.downloadsFile)) {
      try {
        const raw = fs.readFileSync(this.downloadsFile, 'utf8');
        this.memoryDownloads = JSON.parse(raw);
        // Force state reset for downloads that were active during a crash/shutdown
        this.memoryDownloads = this.memoryDownloads.map(item => {
          if (item.status === 'downloading' || item.status === 'queued') {
            item.status = 'paused';
            // Also reset active segment status
            item.segments = item.segments.map(seg => {
              if (seg.status === 'downloading') {
                seg.status = 'idle';
              }
              return seg;
            });
          }
          return item;
        });
        this.saveDownloads(this.memoryDownloads);
      } catch (e) {
        console.error('Failed to parse downloads database, using empty.', e);
        this.memoryDownloads = [];
        this.saveDownloads(this.memoryDownloads);
      }
    } else {
      this.memoryDownloads = [];
      this.saveDownloads(this.memoryDownloads);
    }
  }

  private getDefaultSettings(): AppSettings {
    let defaultDownloadDir = '';
    try {
      defaultDownloadDir = path.join(app.getPath('downloads'));
    } catch {
      defaultDownloadDir = path.join(process.cwd(), 'downloads');
    }

    const defaultTempDir = path.join(this.userDataPath, 'temp');

    return {
      general: {
        launchOnStart: true,
        clipboardMonitoring: false,
        rememberLastSave: true,
        tempDirectory: defaultTempDir,
        defaultSaveDirectory: defaultDownloadDir,
        skipHtml: true,
        askSaveLocation: false,
      },
      network: {
        maxConnections: 8,
        speedLimit: 0, // unlimited
        proxyEnabled: false,
      },
      browser: {
        interceptAll: true,
        monitoredExtensions: [
          '3GP', '7Z', 'AAC', 'ACE', 'AIF', 'APK', 'ARJ', 'ASF', 'AVI', 'BIN', 'BZ2', 'EXE', 'GZ', 'GZIP',
          'IMG', 'ISO', 'LZH', 'M4A', 'M4V', 'MKV', 'MOV', 'MP3', 'MP4', 'MPA', 'MPE', 'MPEG', 'MPG', 'MSI',
          'MSU', 'OGG', 'OGV', 'PDF', 'PLJ', 'PPS', 'PPT', 'QT', 'R0*', 'R1*', 'RA', 'RAR', 'RM', 'RMVB',
          'SEA', 'SIT', 'SITX', 'TAR', 'TIF', 'TIFF', 'WAV', 'WMA', 'WMV', 'Z', 'ZIP'
        ],
        preventKey: 'Delete',
        forceKey: 'Insert',
      },
      scheduler: {
        enabled: false,
        shutdownOnComplete: false,
        disconnectOnComplete: false,
      }
    };
  }

  // Atomic file save helper
  private saveAtomically(filePath: string, data: any) {
    const tempFile = filePath + '.tmp';
    try {
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, filePath);
    } catch (e) {
      console.error(`Failed to atomically save data to ${filePath}`, e);
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
    }
  }

  public getSettings(): AppSettings {
    return this.memorySettings;
  }

  public saveSettings(settings: AppSettings) {
    this.memorySettings = settings;
    this.saveAtomically(this.settingsFile, settings);
  }

  public getDownloads(): DownloadItem[] {
    return this.memoryDownloads;
  }

  public saveDownloads(downloads: DownloadItem[]) {
    this.memoryDownloads = downloads;
    this.saveAtomically(this.downloadsFile, downloads);
  }

  public addDownload(item: DownloadItem) {
    this.memoryDownloads.unshift(item);
    this.saveDownloads(this.memoryDownloads);
  }

  public updateDownload(id: string, updates: Partial<DownloadItem>) {
    const idx = this.memoryDownloads.findIndex(item => item.id === id);
    if (idx !== -1) {
      this.memoryDownloads[idx] = { ...this.memoryDownloads[idx], ...updates };
      this.saveDownloads(this.memoryDownloads);
    }
  }

  public deleteDownload(id: string) {
    const idx = this.memoryDownloads.findIndex(item => item.id === id);
    if (idx !== -1) {
      const item = this.memoryDownloads[idx];
      // Clean up temp directories if they exist
      if (fs.existsSync(item.tempPath)) {
        try {
          fs.rmSync(item.tempPath, { recursive: true, force: true });
        } catch (e) {
          console.error(`Could not clean up temp path: ${item.tempPath}`, e);
        }
      }
      this.memoryDownloads.splice(idx, 1);
      this.saveDownloads(this.memoryDownloads);
    }
  }
}
