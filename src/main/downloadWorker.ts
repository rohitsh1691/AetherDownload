import { parentPort, workerData } from 'worker_threads';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { URL } from 'url';

interface WorkerConfig {
  type?: 'standard' | 'hls-segment';
  url: string;
  headers?: Record<string, string>;
  proxy?: string;
  start: number;
  end: number;
  downloaded: number;
  savePath: string;
  index: number;
  speedLimit: number; // in bytes per second (0 = unlimited)
  rangesSupported?: boolean;
}

const config = workerData as WorkerConfig;

function startWorker() {
  const isHls = config.type === 'hls-segment';
  const parsedUrl = new URL(config.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const requestModule = isHttps ? https : http;

  const currentStart = config.start + config.downloaded;
  
  if (!isHls && currentStart > config.end) {
    if (parentPort) {
      parentPort.postMessage({ type: 'completed', index: config.index });
    }
    process.exit(0);
  }

  // Create headers
  const headers = { ...config.headers };
  if (!isHls && config.rangesSupported !== false) {
    headers['Range'] = `bytes=${currentStart}-${config.end}`;
  }
  if (!headers['User-Agent']) {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  const options: any = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: headers,
    timeout: 15000,
  };

  // Open file descriptor
  let fd: number;
  try {
    if (isHls) {
      // HLS writes sequentially to a fresh temporary segment file
      fd = fs.openSync(config.savePath, 'w');
    } else {
      fd = fs.openSync(config.savePath, 'r+');
    }
  } catch (err) {
    fd = fs.openSync(config.savePath, 'w');
  }

  let fileOffset = isHls ? 0 : currentStart;
  let connectionDownloaded = 0;
  let retryCount = 0;
  const maxRetries = 5;
  let lastRequestedUrl = config.url;

  // Throttling
  const throttleWindowMs = 200;
  const maxBytesPerWindow = config.speedLimit > 0 ? (config.speedLimit * (throttleWindowMs / 1000)) : Infinity;
  let bytesDownloadedThisWindow = 0;
  let windowStart = Date.now();

  let currentReq: any = null;

  function makeRequest(currentUrl: string) {
    lastRequestedUrl = currentUrl;
    const parsedUrl = new URL(currentUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const requestHeaders = { ...headers };
    if (!isHls) {
      const remainingStart = config.start + config.downloaded + connectionDownloaded;
      requestHeaders['Range'] = `bytes=${remainingStart}-${config.end}`;
      console.log(`[Worker ${config.index}] Requesting Range: ${requestHeaders['Range']} (Attempt: ${retryCount + 1})`);
    }

    const options: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: requestHeaders,
      timeout: 15000,
    };

    currentReq = requestModule.request(options, (res) => {
      console.log(`[Worker ${config.index}] Status: ${res.statusCode}, Location: ${res.headers.location}`);
      // Follow redirects (301, 302, 303, 307, 308)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, currentUrl).toString();
        console.log(`[Worker ${config.index}] Redirecting to: ${redirectUrl}`);
        makeRequest(redirectUrl);
        return;
      }

      // Expected status codes: 200 for full chunk (HLS), 206 for range (Standard)
      const expectedStatus = isHls ? 200 : 206;
      if (res.statusCode !== expectedStatus && res.statusCode !== 200) {
        handleError(new Error(`Server returned status code: ${res.statusCode}`));
        return;
      }

      // Reset retry count on successful response headers
      retryCount = 0;

      res.on('data', (chunk: Buffer) => {
        try {
          if (isHls) {
            fs.writeSync(fd, chunk, 0, chunk.length);
          } else {
            fs.writeSync(fd, chunk, 0, chunk.length, fileOffset);
            fileOffset += chunk.length;
          }

          connectionDownloaded += chunk.length;
          bytesDownloadedThisWindow += chunk.length;

          if (parentPort) {
            parentPort.postMessage({
              type: 'progress',
              index: config.index,
              bytes: chunk.length
            });
          }

          if (config.speedLimit > 0 && bytesDownloadedThisWindow >= maxBytesPerWindow) {
            const now = Date.now();
            const elapsed = now - windowStart;
            const waitTime = throttleWindowMs - elapsed;

            if (waitTime > 0) {
              res.pause();
              setTimeout(() => {
                res.resume();
                windowStart = Date.now();
                bytesDownloadedThisWindow = 0;
              }, waitTime);
            } else {
              windowStart = now;
              bytesDownloadedThisWindow = 0;
            }
          }
        } catch (err) {
          handleError(err as Error);
        }
      });

      res.on('end', () => {
        cleanup();
      });

      res.on('error', (err: any) => {
        handleError(err);
      });
    });

    currentReq.on('timeout', () => {
      currentReq.destroy();
      handleError(new Error('Connection timed out.'));
    });

    currentReq.on('error', (err: any) => {
      handleError(err);
    });

    currentReq.end();
  }

  function handleError(err: Error) {
    if (retryCount < maxRetries) {
      retryCount++;
      const delay = Math.min(10000, Math.pow(2, retryCount) * 1000);
      console.warn(`[Worker ${config.index}] Temporary error on segment: ${err.message}. Retrying in ${delay}ms...`);
      
      if (!isHls && config.rangesSupported === false) {
        // Reset file for non-range downloads
        try {
          fs.closeSync(fd);
        } catch (e) {}
        try {
          fd = fs.openSync(config.savePath, 'w');
        } catch (e) {
          cleanup(e as Error);
          return;
        }
        
        // Notify parent process that we had to reset downloaded bytes for this worker
        if (parentPort) {
          parentPort.postMessage({
            type: 'progress',
            index: config.index,
            bytes: -connectionDownloaded
          });
        }
        connectionDownloaded = 0;
        fileOffset = 0;
      }

      setTimeout(() => {
        makeRequest(lastRequestedUrl);
      }, delay);
    } else {
      cleanup(err);
    }
  }

  makeRequest(config.url);

  function cleanup(err?: Error) {
    try {
      if (fd) fs.closeSync(fd);
    } catch (e) {}

    if (err) {
      if (parentPort) {
        parentPort.postMessage({
          type: 'error',
          index: config.index,
          error: err.message
        });
      }
      process.exit(1);
    } else {
      if (parentPort) {
        parentPort.postMessage({
          type: 'completed',
          index: config.index
        });
      }
      process.exit(0);
    }
  }
}

startWorker();
