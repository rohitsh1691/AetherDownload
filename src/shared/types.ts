export interface DownloadSegment {
  index: number;
  start: number;             // Start byte offset
  end: number;               // End byte offset (inclusive)
  downloaded: number;        // Bytes downloaded in this segment
  status: 'idle' | 'downloading' | 'completed' | 'failed';
  url?: string;              // Optional URL for HLS/DASH segment files
}

export interface DownloadItem {
  id: string;                // UUID
  url: string;               // Target URL
  fileName: string;          // Filename
  savePath: string;          // Target directory path
  tempPath: string;          // Directory path for temporary files/parts
  totalBytes: number;        // File size in bytes (-1 if chunked/unknown)
  downloadedBytes: number;   // Total bytes successfully downloaded
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
  category: 'videos' | 'music' | 'documents' | 'programs' | 'archives' | 'general';
  createdAt: number;         // Timestamp
  completedAt?: number;      // Timestamp
  errorMessage?: string;     // Reason for failure
  connectionsCount: number;  // Max connections allowed (e.g. 8, 16, 32)
  rangesSupported: boolean;  // Does the server support ranges?
  userAgent?: string;        // Custom User-Agent
  headers?: Record<string, string>; // Custom headers (auth tokens, cookies)
  proxy?: string;            // Proxy server URL
  segments: DownloadSegment[];
  speed?: number;            // Current speed in B/s (runtime only)
  eta?: number;              // Estimated remaining seconds (runtime only)
}

export interface AppSettings {
  general: {
    launchOnStart: boolean;
    clipboardMonitoring: boolean;
    rememberLastSave: boolean;
    tempDirectory: string;
    defaultSaveDirectory: string;
    skipHtml: boolean;
    askSaveLocation: boolean;
  };
  network: {
    maxConnections: number;  // Default: 8, Max: 32
    speedLimit: number;      // Bandwidth throttling limit in B/s (0 = unlimited)
    proxyEnabled: boolean;
    proxyUrl?: string;
    proxyUsername?: string;
    proxyPassword?: string;
  };
  browser: {
    interceptAll: boolean;
    monitoredExtensions: string[]; // List of extensions to intercept
    preventKey: string;      // "Delete" or other key
    forceKey: string;        // "Insert" or other key
  };
  scheduler: {
    enabled: boolean;
    startTime?: string;      // HH:MM:SS
    stopTime?: string;       // HH:MM:SS
    shutdownOnComplete: boolean;
    disconnectOnComplete: boolean;
  };
}

export interface MediaStreamInfo {
  url: string;
  title: string;
  quality?: string;
  format: string;            // e.g. "mp4", "m3u8", "mp3"
  size?: string;             // Estimated size, if known
  headers?: Record<string, string>;
}
