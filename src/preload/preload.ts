import { contextBridge, ipcRenderer } from 'electron';
import { AppSettings, DownloadItem, MediaStreamInfo } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  // DB & General Operations
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('db:get-settings'),
  saveSettings: (settings: AppSettings): Promise<void> => ipcRenderer.invoke('db:save-settings', settings),
  getDownloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke('db:get-downloads'),
  
  // Download Control
  addDownload: (url: string, customPath?: string, headers?: Record<string, string>, title?: string, exactFilePath?: string): Promise<DownloadItem> => 
    ipcRenderer.invoke('download:add', url, customPath, headers, title, exactFilePath),
  startDownload: (id: string): Promise<void> => ipcRenderer.invoke('download:start', id),
  pauseDownload: (id: string): Promise<void> => ipcRenderer.invoke('download:pause', id),
  deleteDownload: (id: string): Promise<void> => ipcRenderer.invoke('download:delete', id),
  deleteAllDownloads: (): Promise<void> => ipcRenderer.invoke('download:delete-all'),
  
  // Media Detection
  getDetectedMedia: (): Promise<MediaStreamInfo[]> => ipcRenderer.invoke('media:get-detected'),
  clearDetectedMedia: (): Promise<void> => ipcRenderer.invoke('media:clear'),

  // Listeners from Main Process
  onDownloadProgress: (callback: (item: DownloadItem) => void) => {
    ipcRenderer.removeAllListeners('download:progress');
    ipcRenderer.on('download:progress', (_event, item) => callback(item));
  },
  onMediaDetected: (callback: (media: MediaStreamInfo) => void) => {
    ipcRenderer.removeAllListeners('media:detected');
    ipcRenderer.on('media:detected', (_event, media) => callback(media));
  },

  // Shell Utilities
  openFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke('shell:open-file', filePath),
  openFolder: (filePath: string): Promise<boolean> => ipcRenderer.invoke('shell:open-folder', filePath),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('shell:select-directory'),
  selectSavePath: (defaultPath: string): Promise<string | null> => ipcRenderer.invoke('shell:select-save-path', defaultPath),
  
  // Drag and Drop
  dragStart: (id: string) => ipcRenderer.send('drag:start', id)
});
