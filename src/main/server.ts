import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';
import { dialog, BrowserWindow } from 'electron';
import { DownloadEngine } from './engine';
import { MediaStreamInfo } from '../shared/types';

export class IntegrationServer {
  private server!: http.Server;
  private port: number = 9654;
  private engine: DownloadEngine;
  private detectedMedia: MediaStreamInfo[] = [];
  private onMediaDetectedCallback: (media: MediaStreamInfo) => void;

  constructor(engine: DownloadEngine, onMediaDetected: (media: MediaStreamInfo) => void) {
    this.engine = engine;
    this.onMediaDetectedCallback = onMediaDetected;
    this.startServer();
  }

  private startServer() {
    this.server = http.createServer((req, res) => {
      // Set CORS Headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent, Referer, Cookie');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url || '';

      if (req.method === 'POST' && url === '/download') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            if (!data.url) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing target download URL' }));
              return;
            }

            // Guess initial filename for save file dialog
            let fileName = '';
            try {
              const parsedUrl = new URL(data.url);
              const isHls = parsedUrl.pathname.toLowerCase().includes('.m3u8');
              if (data.title) {
                const cleanTitle = path.basename(data.title);
                fileName = cleanTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
                const ext = path.extname(fileName);
                if (!ext) {
                  const urlExt = path.extname(parsedUrl.pathname);
                  if (urlExt && !urlExt.includes('?')) {
                    fileName += urlExt;
                  }
                }
              } else {
                fileName = path.basename(parsedUrl.pathname);
                if (!fileName || fileName.includes('?')) {
                  fileName = 'download_' + Date.now();
                }
              }
              if (isHls) {
                if (fileName.toLowerCase().endsWith('.m3u8')) {
                  fileName = fileName.slice(0, -5);
                }
                if (!fileName.toLowerCase().endsWith('.ts') && !fileName.toLowerCase().endsWith('.mp4')) {
                  fileName += '.ts';
                }
              }
            } catch (err) {
              fileName = 'download_' + Date.now();
            }

            const settings = this.engine.db.getSettings();
            let exactFilePath: string | undefined = undefined;

            if (settings.general.askSaveLocation) {
              const windows = BrowserWindow.getAllWindows();
              const mainWindow = windows.find(w => !w.isDestroyed());
              
              if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
              }
              
              const defaultPath = path.join(settings.general.defaultSaveDirectory, fileName);
              const options = {
                defaultPath,
                properties: ['showOverwriteConfirmation'] as any,
              };
              const result = mainWindow 
                ? await dialog.showSaveDialog(mainWindow, options)
                : await dialog.showSaveDialog(options);
              
              if (result.canceled || !result.filePath) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, reason: 'cancelled' }));
                return;
              }
              exactFilePath = result.filePath;
            }

            console.log(`Interception server: adding download URL ${data.url}`);
            const item = await this.engine.addDownload(data.url, undefined, data.headers, data.title, exactFilePath);
            this.engine.startDownload(item.id).catch(console.error);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, downloadId: item.id }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } 
      else if (req.method === 'POST' && url === '/media-detected') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const mediaInfo = JSON.parse(body) as MediaStreamInfo;
            if (!mediaInfo.url || !mediaInfo.format) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing media metadata' }));
              return;
            }

            // Deduplicate
            const exists = this.detectedMedia.some(m => m.url === mediaInfo.url);
            if (!exists) {
              this.detectedMedia.unshift(mediaInfo);
              if (this.detectedMedia.length > 50) this.detectedMedia.pop(); // Cap size
              this.onMediaDetectedCallback(mediaInfo);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } 
      else if (req.method === 'GET' && url === '/detected-media') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.detectedMedia));
      } 
      else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`Browser integration server listening on http://localhost:${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('Failed to start integration server:', err);
    });
  }

  public getDetectedMedia(): MediaStreamInfo[] {
    return this.detectedMedia;
  }

  public clearDetectedMedia() {
    this.detectedMedia = [];
  }

  public close() {
    if (this.server) {
      this.server.close();
    }
  }
}
