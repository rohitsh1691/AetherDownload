import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { DatabaseService } from './db';
import { DownloadItem, DownloadSegment, AppSettings } from '../shared/types';

export class DownloadEngine {
  public db: DatabaseService;
  private activeWorkers: Map<string, { 
    workers: Map<number, Worker>; // segmentIndex -> Worker
    speedInterval: NodeJS.Timeout; 
    lastBytes: number; 
    speedHistory: number[];
  }> = new Map();
  private progressCallback: (item: DownloadItem) => void;

  constructor(db: DatabaseService, progressCallback: (item: DownloadItem) => void) {
    this.db = db;
    this.progressCallback = progressCallback;

    this.checkQueue();
  }

  private checkQueue() {
    const downloads = this.db.getDownloads();
    const queuedItems = downloads.filter(item => item.status === 'queued');
    const activeCount = downloads.filter(item => item.status === 'downloading').length;

    const limit = Math.max(1, 3 - activeCount);
    queuedItems.slice(0, limit).forEach(item => {
      this.startDownload(item.id).catch(console.error);
    });
  }

  public async addDownload(url: string, customSavePath?: string, headers?: Record<string, string>, title?: string, exactFilePath?: string): Promise<DownloadItem> {
    const settings = this.db.getSettings();
    const parsedUrl = new URL(url);
    const isHls = parsedUrl.pathname.toLowerCase().includes('.m3u8');
    
    let fileName = '';
    if (title) {
      const cleanTitle = path.basename(title);
      fileName = cleanTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
      
      const ext = path.extname(fileName);
      if (!ext) {
        const urlExt = path.extname(parsedUrl.pathname);
        if (urlExt && !urlExt.includes('?')) {
          fileName += urlExt;
        }
      }
    }

    if (!fileName) {
      fileName = path.basename(parsedUrl.pathname);
      if (!fileName || fileName.includes('?')) {
        fileName = 'download_' + Date.now();
      }
      if (isHls && fileName.toLowerCase().endsWith('.m3u8')) {
        fileName = fileName.slice(0, -5);
      }
    }

    // Resolve extension if url is HLS
    if (isHls) {
      if (fileName.toLowerCase().endsWith('.m3u8')) {
        fileName = fileName.slice(0, -5);
      }
      if (!fileName.toLowerCase().endsWith('.ts') && !fileName.toLowerCase().endsWith('.mp4')) {
        // Default compiled HLS streams to transport stream video format (.ts)
        fileName += '.ts';
      }
    }

    let finalSavePath = '';
    let finalFileName = '';

    if (exactFilePath) {
      finalSavePath = exactFilePath;
      finalFileName = path.basename(exactFilePath);
      const saveDir = path.dirname(exactFilePath);
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
    } else {
      const saveDir = customSavePath || settings.general.defaultSaveDirectory;
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
      const unique = this.getUniqueSavePath(saveDir, fileName);
      finalSavePath = unique.savePath;
      finalFileName = unique.fileName;
    }

    const tempDirName = `aether_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const tempPath = path.join(settings.general.tempDirectory, tempDirName);

    const item: DownloadItem = {
      id: this.generateUUID(),
      url,
      fileName: finalFileName,
      savePath: finalSavePath,
      tempPath,
      totalBytes: -1,
      downloadedBytes: 0,
      status: 'queued',
      category: this.determineCategory(fileName),
      createdAt: Date.now(),
      connectionsCount: settings.network.maxConnections,
      rangesSupported: false,
      headers: headers || {},
      segments: []
    };

    this.db.addDownload(item);
    return item;
  }

  public async startDownload(id: string): Promise<void> {
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === id);
    if (!item) throw new Error('Download item not found');

    if (item.status === 'downloading') return;

    item.status = 'downloading';
    item.errorMessage = undefined;
    this.db.updateDownload(id, { status: 'downloading', errorMessage: undefined });

    try {
      const isHls = item.url.toLowerCase().includes('.m3u8');
      
      if (isHls) {
        await this.startHlsDownload(item);
      } else {
        await this.startStandardDownload(item);
      }
    } catch (err: any) {
      console.error('Error starting download:', err);
      this.db.updateDownload(id, { status: 'failed', errorMessage: err.message });
      item.status = 'failed';
      item.errorMessage = err.message;
      this.progressCallback(item);
    }
  }

  // standard range-based parallel downloader
  private async startStandardDownload(item: DownloadItem) {
    const metadata = await this.handshake(item.url, item.headers);
    
    const updatedInfo: Partial<DownloadItem> = {
      rangesSupported: metadata.rangesSupported,
      totalBytes: metadata.contentLength,
      url: metadata.finalUrl
    };

    item.url = metadata.finalUrl;

    if (metadata.fileName && item.fileName.startsWith('download_')) {
      const saveDir = path.dirname(item.savePath);
      const { savePath: uniquePath, fileName: uniqueName } = this.getUniqueSavePath(saveDir, metadata.fileName);
      updatedInfo.fileName = uniqueName;
      updatedInfo.savePath = uniquePath;
      item.fileName = uniqueName;
      item.savePath = uniquePath;
    }

    item.rangesSupported = metadata.rangesSupported;
    item.totalBytes = metadata.contentLength;

    if (!fs.existsSync(item.tempPath)) {
      fs.mkdirSync(item.tempPath, { recursive: true });
    }

    if (item.segments.length === 0) {
      if (item.rangesSupported && item.totalBytes > 0) {
        const segmentSize = Math.floor(item.totalBytes / item.connectionsCount);
        const segments: DownloadSegment[] = [];
        for (let i = 0; i < item.connectionsCount; i++) {
          const start = i * segmentSize;
          const end = (i === item.connectionsCount - 1) ? item.totalBytes - 1 : (start + segmentSize - 1);
          segments.push({
            index: i,
            start,
            end,
            downloaded: 0,
            status: 'idle'
          });
        }
        item.segments = segments;
      } else {
        item.segments = [{
          index: 0,
          start: 0,
          end: item.totalBytes > 0 ? item.totalBytes - 1 : -1,
          downloaded: 0,
          status: 'idle'
        }];
      }
      updatedInfo.segments = item.segments;
    }

    this.db.updateDownload(item.id, updatedInfo);

    if (item.rangesSupported && item.totalBytes > 0) {
      const dir = path.dirname(item.savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const fd = fs.openSync(item.savePath, 'w');
      fs.ftruncateSync(fd, item.totalBytes);
      fs.closeSync(fd);
    }

    this.launchWorkers(item);
  }

  // Native HLS (.m3u8) parser, downloader, and sequencer
  private async startHlsDownload(item: DownloadItem) {
    if (!fs.existsSync(item.tempPath)) {
      fs.mkdirSync(item.tempPath, { recursive: true });
    }

    // Parse playlist segments if not loaded
    if (item.segments.length === 0) {
      console.log(`Parsing HLS Playlist: ${item.url}`);
      const playlistContent = await this.fetchTextFile(item.url, item.headers);
      
      let mediaPlaylistUrl = item.url;
      let parsedContent = playlistContent;

      // Resolve Master Playlist resolutions
      if (playlistContent.includes('#EXT-X-STREAM-INF')) {
        const lines = playlistContent.split('\n');
        let bestSubPlaylist = '';
        let highestBw = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            const nextLine = lines[i + 1]?.trim();
            
            if (nextLine && !nextLine.startsWith('#') && bw > highestBw) {
              highestBw = bw;
              bestSubPlaylist = nextLine;
            }
          }
        }

        if (bestSubPlaylist) {
          mediaPlaylistUrl = new URL(bestSubPlaylist, item.url).toString();
          console.log(`Selecting highest resolution sub-playlist: ${mediaPlaylistUrl}`);
          parsedContent = await this.fetchTextFile(mediaPlaylistUrl, item.headers);
        }
      }

      // Extract all segment urls
      const lines = parsedContent.split('\n');
      const segmentUrls: string[] = [];
      let usesFmp4 = false;
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-MAP:')) {
          usesFmp4 = true;
          const uriMatch = trimmed.match(/URI=["']?([^"']+)["']?/i);
          if (uriMatch && uriMatch[1]) {
            const absoluteInitUrl = new URL(uriMatch[1], mediaPlaylistUrl).toString();
            segmentUrls.push(absoluteInitUrl);
          }
        } else if (trimmed && !trimmed.startsWith('#')) {
          const absoluteUrl = new URL(trimmed, mediaPlaylistUrl).toString();
          segmentUrls.push(absoluteUrl);
        }
      });

      if (segmentUrls.length === 0) {
        throw new Error('No streaming segments found in HLS playlist manifest.');
      }

      console.log(`HLS Interceptor found: ${segmentUrls.length} chunks (fMP4: ${usesFmp4}).`);

      if (usesFmp4) {
        let newFileName = item.fileName;
        if (newFileName.toLowerCase().endsWith('.ts')) {
          newFileName = newFileName.slice(0, -3);
        }
        if (!newFileName.toLowerCase().endsWith('.mp4')) {
          newFileName += '.mp4';
        }
        if (newFileName !== item.fileName) {
          const saveDir = path.dirname(item.savePath);
          const { savePath: uniquePath, fileName: uniqueName } = this.getUniqueSavePath(saveDir, newFileName);
          item.fileName = uniqueName;
          item.savePath = uniquePath;
        }
      }

      // Configure chunks inside DB segment rows
      item.segments = segmentUrls.map((segUrl, idx) => ({
        index: idx,
        start: 0,
        end: -1,
        downloaded: 0,
        status: 'idle',
        url: segUrl
      }));

      this.db.updateDownload(item.id, {
        segments: item.segments,
        rangesSupported: false,
        totalBytes: -1, // Size unknown, tracked by segment percentage
        fileName: item.fileName,
        savePath: item.savePath
      });
    }

    this.launchWorkers(item);
  }

  private launchWorkers(item: DownloadItem) {
    const isHls = item.url.toLowerCase().includes('.m3u8');
    const workersMap = new Map<number, Worker>();
    const settings = this.db.getSettings();
    const speedLimitPerSegment = settings.network.speedLimit > 0 
      ? Math.floor(settings.network.speedLimit / item.connectionsCount) 
      : 0;

    const activeInfo = {
      workers: workersMap,
      speedInterval: undefined as any,
      lastBytes: item.downloadedBytes,
      speedHistory: []
    };
    
    this.activeWorkers.set(item.id, activeInfo);

    if (isHls) {
      // Sliding window concurrency controller: start max connectionsCount workers initially
      this.processHlsQueue(item.id);
    } else {
      // standard Range connections
      item.segments.forEach(seg => {
        if (seg.status === 'completed') return;

        seg.status = 'downloading';
        
        const workerPath = path.join(__dirname, 'downloadWorker.js');
        const worker = new Worker(workerPath, {
          workerData: {
            url: item.url,
            headers: item.headers,
            start: seg.start,
            end: seg.end,
            downloaded: seg.downloaded,
            savePath: item.savePath,
            index: seg.index,
            speedLimit: speedLimitPerSegment,
            rangesSupported: item.rangesSupported
          }
        });

        worker.on('message', (msg) => this.handleWorkerMessage(item.id, seg.index, msg));
        worker.on('error', (err) => this.handleWorkerError(item.id, seg.index, err));
        
        workersMap.set(seg.index, worker);
      });
      this.db.updateDownload(item.id, { segments: item.segments });
    }

    activeInfo.speedInterval = setInterval(() => {
      this.calculateSpeedAndETA(item.id);
    }, 1000);
  }

  // Sliding window download executor for HLS segments
  private processHlsQueue(itemId: string) {
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === itemId);
    const active = this.activeWorkers.get(itemId);
    if (!item || !active || item.status !== 'downloading') return;

    // Count currently downloading threads
    const downloadingCount = Array.from(active.workers.values()).length;
    const slotsAvailable = item.connectionsCount - downloadingCount;

    if (slotsAvailable <= 0) return;

    // Find next idle chunks to download
    const idleSegments = item.segments.filter(s => s.status === 'idle');
    const settings = this.db.getSettings();
    const speedLimitPerSegment = settings.network.speedLimit > 0 
      ? Math.floor(settings.network.speedLimit / item.connectionsCount) 
      : 0;

    idleSegments.slice(0, slotsAvailable).forEach(seg => {
      seg.status = 'downloading';
      
      const tempSegPath = path.join(item.tempPath, `seg_${seg.index}.ts`);
      const workerPath = path.join(__dirname, 'downloadWorker.js');
      
      const worker = new Worker(workerPath, {
        workerData: {
          type: 'hls-segment',
          url: seg.url,
          headers: item.headers,
          start: 0,
          end: -1,
          downloaded: 0,
          savePath: tempSegPath,
          index: seg.index,
          speedLimit: speedLimitPerSegment
        }
      });

      worker.on('message', (msg) => this.handleWorkerMessage(itemId, seg.index, msg));
      worker.on('error', (err) => this.handleWorkerError(itemId, seg.index, err));
      worker.on('exit', () => {
        active.workers.delete(seg.index);
        this.processHlsQueue(itemId); // Trigger next in queue
      });

      active.workers.set(seg.index, worker);
    });

    this.db.updateDownload(itemId, { segments: item.segments });
  }

  private handleWorkerMessage(itemId: string, segmentIndex: number, msg: any) {
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === itemId);
    if (!item) return;

    const isHls = item.url.toLowerCase().includes('.m3u8');

    if (msg.type === 'progress') {
      const seg = item.segments.find(s => s.index === segmentIndex);
      if (seg) {
        seg.downloaded += msg.bytes;
        item.downloadedBytes += msg.bytes;
        this.progressCallback(item);
      }
    } else if (msg.type === 'completed') {
      const seg = item.segments.find(s => s.index === segmentIndex);
      if (seg) {
        seg.status = 'completed';
        this.db.updateDownload(itemId, { segments: item.segments });
      }

      if (isHls) {
        const active = this.activeWorkers.get(itemId);
        if (active) active.workers.delete(segmentIndex);
        
        // Check for completion or continue queue
        this.checkDownloadCompletion(itemId);
        this.processHlsQueue(itemId);
      } else {
        this.checkDownloadCompletion(itemId);
      }
    } else if (msg.type === 'error') {
      this.handleWorkerError(itemId, segmentIndex, new Error(msg.error));
    }
  }

  private handleWorkerError(itemId: string, segmentIndex: number, error: Error) {
    console.error(`Worker error on segment ${segmentIndex} of download ${itemId}:`, error);
    this.pauseDownload(itemId);
    
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === itemId);
    if (item) {
      item.status = 'failed';
      item.errorMessage = `Chunk ${segmentIndex} failed: ${error.message}`;
      this.db.updateDownload(itemId, { status: 'failed', errorMessage: item.errorMessage });
      this.progressCallback(item);
    }
  }

  private async checkDownloadCompletion(itemId: string) {
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === itemId);
    if (!item) return;

    const allCompleted = item.segments.every(s => s.status === 'completed');
    if (allCompleted && item.status === 'downloading') {
      
      const isHls = item.url.toLowerCase().includes('.m3u8');
      if (isHls) {
        try {
          item.status = 'paused'; // Prevent double compiling triggers
          console.log(`HLS Complete: Concatenating segment chunks for ${item.fileName}...`);
          await this.compileHlsSegments(item);
        } catch (e: any) {
          console.error('Failed to compile HLS segments:', e);
          item.status = 'failed';
          item.errorMessage = 'Segment compiler failed: ' + e.message;
          this.db.updateDownload(itemId, { status: 'failed', errorMessage: item.errorMessage });
          this.cleanupDownload(itemId);
          this.progressCallback(item);
          return;
        }
      }

      this.db.updateDownload(itemId, { 
        status: 'completed', 
        completedAt: Date.now(),
        downloadedBytes: item.totalBytes > 0 ? item.totalBytes : item.downloadedBytes
      });
      item.status = 'completed';
      item.completedAt = Date.now();
      
      this.cleanupDownload(itemId);
      this.progressCallback(item);

      this.triggerAutoActions();
      this.checkQueue();
    }
  }

  // Sequences and compiles HLS TS segments into a single file
  private async compileHlsSegments(item: DownloadItem): Promise<void> {
    const destPath = item.savePath;
    const tempPathDir = item.tempPath;
    
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(destPath);

    for (let i = 0; i < item.segments.length; i++) {
      const segmentFile = path.join(tempPathDir, `seg_${i}.ts`);
      if (!fs.existsSync(segmentFile)) {
        writeStream.end();
        throw new Error(`Missing expected segment file: ${segmentFile}`);
      }

      await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(segmentFile);
        readStream.on('error', (err) => {
          reject(err);
        });
        
        readStream.on('end', () => {
          try { fs.unlinkSync(segmentFile); } catch {}
          resolve();
        });
        
        readStream.pipe(writeStream, { end: false });
      });
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => {
        resolve();
      });
      writeStream.on('error', (err) => {
        reject(err);
      });
      writeStream.end();
    });
    
    try {
      fs.rmSync(tempPathDir, { recursive: true, force: true });
    } catch {}
  }

  public pauseDownload(id: string) {
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === id);
    if (!item || item.status !== 'downloading') return;

    const active = this.activeWorkers.get(id);
    if (active) {
      active.workers.forEach(w => w.terminate());
      clearInterval(active.speedInterval);
      this.activeWorkers.delete(id);
    }

    item.status = 'paused';
    item.segments = item.segments.map(s => {
      if (s.status === 'downloading') s.status = 'idle';
      return s;
    });

    this.db.updateDownload(id, { status: 'paused', segments: item.segments });
    item.speed = 0;
    item.eta = undefined;
    this.progressCallback(item);
  }

  public deleteAllDownloads() {
    const downloads = [...this.db.getDownloads()];
    downloads.forEach(d => {
      if (d.status === 'downloading') {
        this.pauseDownload(d.id);
      }
      this.db.deleteDownload(d.id);
    });
    this.checkQueue();
  }

  private cleanupDownload(id: string) {
    const active = this.activeWorkers.get(id);
    if (active) {
      clearInterval(active.speedInterval);
      this.activeWorkers.delete(id);
    }
  }

  private calculateSpeedAndETA(id: string) {
    const downloads = this.db.getDownloads();
    const item = downloads.find(d => d.id === id);
    const active = this.activeWorkers.get(id);
    if (!item || !active) return;

    const currentBytes = item.downloadedBytes;
    const speed = Math.max(0, currentBytes - active.lastBytes);
    active.lastBytes = currentBytes;

    let smoothedSpeed = speed;
    if (active.speedHistory.length > 0) {
      const lastSmooth = active.speedHistory[active.speedHistory.length - 1];
      smoothedSpeed = Math.round(0.3 * speed + 0.7 * lastSmooth);
    }
    active.speedHistory.push(smoothedSpeed);
    if (active.speedHistory.length > 5) active.speedHistory.shift();

    item.speed = smoothedSpeed;

    const isHls = item.url.toLowerCase().includes('.m3u8');

    if (item.totalBytes > 0) {
      const remainingBytes = item.totalBytes - item.downloadedBytes;
      item.eta = smoothedSpeed > 0 ? Math.ceil(remainingBytes / smoothedSpeed) : 999999;
    } else if (isHls && item.segments.length > 0) {
      // For HLS, calculate ETA based on average segment size and remaining segments
      const completedCount = item.segments.filter(s => s.status === 'completed').length;
      const remainingCount = item.segments.length - completedCount;
      
      if (completedCount > 0 && smoothedSpeed > 0) {
        const averageSegmentSize = item.downloadedBytes / completedCount;
        const remainingBytesApprox = remainingCount * averageSegmentSize;
        item.eta = Math.ceil(remainingBytesApprox / smoothedSpeed);
      } else {
        item.eta = undefined;
      }
    } else {
      item.eta = undefined;
    }

    this.progressCallback(item);
  }

  // HTTP Handshake
  private handshake(urlStr: string, customHeaders?: Record<string, string>): Promise<{ finalUrl: string, contentLength: number, rangesSupported: boolean, fileName?: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const requestModule = isHttps ? https : http;

      const headers = { ...customHeaders };
      if (!headers['User-Agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      }

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'HEAD',
        headers: headers,
        timeout: 10000
      };

      const req = requestModule.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          this.handshake(redirectUrl, customHeaders).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          this.handshakeGet(urlStr, customHeaders).then(resolve).catch(reject);
          return;
        }

        const contentLength = parseInt(res.headers['content-length'] || '-1', 10);
        const rangesSupported = res.headers['accept-ranges'] === 'bytes' || res.headers['content-range'] !== undefined;
        
        let fileName = undefined;
        const disposition = res.headers['content-disposition'];
        if (disposition) {
          const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i) || disposition.match(/filename=["']?([^"';\n]+)/i);
          if (match && match[1]) {
            fileName = decodeURIComponent(match[1]);
          }
        }

        resolve({ finalUrl: urlStr, contentLength, rangesSupported, fileName });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Handshake connection timed out.'));
      });

      req.on('error', (err) => {
        this.handshakeGet(urlStr, customHeaders).then(resolve).catch(reject);
      });

      req.end();
    });
  }

  private handshakeGet(urlStr: string, customHeaders?: Record<string, string>): Promise<{ finalUrl: string, contentLength: number, rangesSupported: boolean, fileName?: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const requestModule = isHttps ? https : http;

      const headers = { ...customHeaders };
      headers['Range'] = 'bytes=0-0';
      if (!headers['User-Agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      }

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: headers,
        timeout: 10000
      };

      const req = requestModule.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          this.handshakeGet(redirectUrl, customHeaders).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Server returned status code: ${res.statusCode}`));
          return;
        }

        const rangesSupported = res.statusCode === 206;
        let contentLength = -1;
        
        if (res.headers['content-range']) {
          const match = res.headers['content-range'].match(/\/(\d+)/);
          if (match && match[1]) {
            contentLength = parseInt(match[1], 10);
          }
        }
        if (contentLength === -1 && res.headers['content-length']) {
          contentLength = parseInt(res.headers['content-length'], 10);
        }

        let fileName = undefined;
        const disposition = res.headers['content-disposition'];
        if (disposition) {
          const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i) || disposition.match(/filename=["']?([^"';\n]+)/i);
          if (match && match[1]) {
            fileName = decodeURIComponent(match[1]);
          }
        }

        resolve({ finalUrl: urlStr, contentLength, rangesSupported, fileName });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Handshake connection timed out.'));
      });

      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  // Text downloader helper that resolves redirects
  private fetchTextFile(urlStr: string, customHeaders?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const requestModule = isHttps ? https : http;

      const headers = { ...customHeaders };
      if (!headers['User-Agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      }

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: headers,
        timeout: 15000
      };

      const req = requestModule.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          this.fetchTextFile(redirectUrl, customHeaders).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Failed to download text playlist, status: ${res.statusCode}`));
          return;
        }

        let body = '';
        res.on('data', chunk => body += chunk.toString());
        res.on('end', () => resolve(body));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Playlist fetch connection timed out.'));
      });

      req.on('error', reject);
      req.end();
    });
  }

  private triggerAutoActions() {
    const settings = this.db.getSettings();
    const downloads = this.db.getDownloads();
    const active = downloads.filter(d => d.status === 'downloading').length;

    if (active === 0) {
      if (settings.scheduler.shutdownOnComplete) {
        console.log('Scheduler triggers: System Shutdown.');
        const { exec } = require('child_process');
        exec('shutdown /s /t 60');
      }
    }
  }

  private determineCategory(fileName: string): DownloadItem['category'] {
    const ext = path.extname(fileName).toUpperCase().replace('.', '');
    const categories: Record<string, DownloadItem['category']> = {
      'MP4': 'videos', 'MKV': 'videos', 'AVI': 'videos', 'MOV': 'videos', 'MPEG': 'videos',
      'MPG': 'videos', 'WMV': 'videos', 'ASF': 'videos', 'OGV': 'videos', 'RM': 'videos',
      'RMVB': 'videos', 'M4V': 'videos', '3GP': 'videos', 'QT': 'videos', 'WEBM': 'videos',
      'TS': 'videos',
      'MP3': 'music', 'AAC': 'music', 'M4A': 'music', 'WAV': 'music', 'WMA': 'music',
      'OGG': 'music', 'RA': 'music',
      'PDF': 'documents', 'PPT': 'documents', 'PPS': 'documents', 'DOC': 'documents',
      'DOCX': 'documents', 'XLS': 'documents', 'XLSX': 'documents', 'TXT': 'documents',
      'EXE': 'programs', 'MSI': 'programs', 'MSU': 'programs', 'APK': 'programs',
      'BAT': 'programs',
      'ZIP': 'archives', 'RAR': 'archives', '7Z': 'archives', 'ACE': 'archives',
      'ARJ': 'archives', 'TAR': 'archives', 'GZ': 'archives', 'GZIP': 'archives',
      'BZ2': 'archives', 'ISO': 'archives', 'IMG': 'archives',
    };

    return categories[ext] || 'general';
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private getUniqueSavePath(saveDir: string, fileName: string): { savePath: string, fileName: string } {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let counter = 1;
    let uniqueFileName = fileName;
    let uniqueSavePath = path.join(saveDir, uniqueFileName);

    const downloads = this.db ? this.db.getDownloads() : [];

    while (
      fs.existsSync(uniqueSavePath) || 
      downloads.some(d => d.savePath === uniqueSavePath && d.status !== 'completed' && d.status !== 'failed')
    ) {
      uniqueFileName = `${base} (${counter})${ext}`;
      uniqueSavePath = path.join(saveDir, uniqueFileName);
      counter++;
    }

    return { savePath: uniqueSavePath, fileName: uniqueFileName };
  }
}
