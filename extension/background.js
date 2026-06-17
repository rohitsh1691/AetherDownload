const LOCAL_SERVER = 'http://localhost:9654';

// 54 extensions monitored by default
const MONITORED_EXTENSIONS = [
  '3GP', '7Z', 'AAC', 'ACE', 'AIF', 'APK', 'ARJ', 'ASF', 'AVI', 'BIN', 'BZ2', 'EXE', 'GZ', 'GZIP',
  'IMG', 'ISO', 'LZH', 'M4A', 'M4V', 'MKV', 'MOV', 'MP3', 'MP4', 'MPA', 'MPE', 'MPEG', 'MPG', 'MSI',
  'MSU', 'OGG', 'OGV', 'PDF', 'PLJ', 'PPS', 'PPT', 'QT', 'R0*', 'R1*', 'RA', 'RAR', 'RM', 'RMVB',
  'SEA', 'SIT', 'SITX', 'TAR', 'TIF', 'TIFF', 'WAV', 'WMA', 'WMV', 'Z', 'ZIP'
];

// Memory map to hold intercepted streams: tabId -> array of streams
const tabStreams = new Map();

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'download-link',
    title: 'Download with AetherDownload',
    contexts: ['link', 'image', 'video', 'audio']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'download-link') {
    const url = info.linkUrl || info.srcUrl;
    if (url) {
      sendToAether(url, tab?.url, tab?.title);
    }
  }
});

// Intercept regular downloads (onDeterminingFilename is supported in Chrome/Edge, fallback to onCreated for Firefox)
if (chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    if (downloadItem.url.startsWith(LOCAL_SERVER)) {
      suggest();
      return;
    }

    chrome.storage.local.get(['bypassActive', 'interceptAll'], (settings) => {
      if (settings.bypassActive) {
        console.log('Interception bypassed: Delete key held.');
        suggest();
        return;
      }

      const url = downloadItem.url;
      const finalUrl = downloadItem.finalUrl || url;
      
      // Ignore unsupported browser-internal protocols (e.g. blob:, data:, chrome-extension:, moz-extension:, about:)
      if (!isSupportedProtocol(url) && !isSupportedProtocol(finalUrl)) {
        suggest();
        return;
      }
      
      // Check extension from URL, final URL, or determined filename
      const extFromUrl = getUrlExtension(url);
      const extFromFinalUrl = getUrlExtension(finalUrl);
      const extFromFilename = getFileExtension(downloadItem.filename);

      const ext = extFromFilename || extFromFinalUrl || extFromUrl;

      const shouldIntercept = settings.interceptAll !== false && 
        ext && (MONITORED_EXTENSIONS.includes(ext) || MONITORED_EXTENSIONS.some(e => {
          if (e.endsWith('*')) {
            return ext.startsWith(e.slice(0, -1));
          }
          return false;
        }));

      if (shouldIntercept) {
        // Cancel the browser download
        chrome.downloads.cancel(downloadItem.id, () => {
          if (chrome.runtime.lastError) {
            // Ignore error if download is not in progress or already cancelled
          }
          chrome.downloads.erase({ id: downloadItem.id }, () => {
            if (chrome.runtime.lastError) {
              // Ignore erase errors
            }
          });
        });
        // Complete the filename determination event
        suggest();
        
        // Send download to Aether
        sendToAether(finalUrl, downloadItem.referrer, downloadItem.filename);
      } else {
        suggest(); // Proceed with Chrome download normally
      }
    });
    
    return true; // Keep message channel open for the async storage fetch
  });
} else {
  // Firefox fallback: Intercept download as soon as it is created
  chrome.downloads.onCreated.addListener((downloadItem) => {
    if (downloadItem.url.startsWith(LOCAL_SERVER)) {
      return;
    }

    chrome.storage.local.get(['bypassActive', 'interceptAll'], (settings) => {
      if (settings.bypassActive) {
        return;
      }

      const url = downloadItem.url;
      const finalUrl = downloadItem.finalUrl || url;
      
      // Ignore unsupported browser-internal protocols (e.g. blob:, data:, chrome-extension:, moz-extension:, about:)
      if (!isSupportedProtocol(url) && !isSupportedProtocol(finalUrl)) {
        return;
      }
      
      const extFromUrl = getUrlExtension(url);
      const extFromFinalUrl = getUrlExtension(finalUrl);
      const extFromFilename = getFileExtension(downloadItem.filename);

      const ext = extFromFilename || extFromFinalUrl || extFromUrl;

      const shouldIntercept = settings.interceptAll !== false && 
        ext && (MONITORED_EXTENSIONS.includes(ext) || MONITORED_EXTENSIONS.some(e => {
          if (e.endsWith('*')) {
            return ext.startsWith(e.slice(0, -1));
          }
          return false;
        }));

      if (shouldIntercept) {
        // Cancel the browser download in Firefox
        chrome.downloads.cancel(downloadItem.id, () => {
          if (chrome.runtime.lastError) {
            // Ignore error
          }
          chrome.downloads.erase({ id: downloadItem.id }, () => {
            if (chrome.runtime.lastError) {
              // Ignore erase errors
            }
          });
        });
        // Send download to Aether
        sendToAether(finalUrl, downloadItem.referrer || '', downloadItem.filename);
      }
    });
  });
}

// Real-time Network Interception (HLS m3u8, DASH mpd, and media files)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const tabId = details.tabId;
    
    if (tabId === -1 || url.startsWith(LOCAL_SERVER)) return;

    const lowerUrl = url.toLowerCase();

    // Fallback: If we intercept an HLS fMP4 initialization segment, reconstruct and intercept the parent .m3u8 playlist instead.
    // This solves MV3 service worker startup delay missing the initial playlist request.
    if (isInitSegmentUrl(lowerUrl)) {
      const reconstructedM3u8Url = reconstructM3u8Url(url);
      if (reconstructedM3u8Url) {
        handleHlsInterception(reconstructedM3u8Url, tabId);
      }
      return;
    }
    
    // STRICT FILTER: Ignore segment requests completely to avoid cluttering and downloading fragmented pieces
    if (isSegmentUrl(lowerUrl)) {
      return;
    }

    // 1. Intercept HLS / M3U8 Playlists
    if (lowerUrl.includes('.m3u8') && !lowerUrl.includes('key')) {
      handleHlsInterception(url, tabId);
    } 
    // 2. Intercept DASH Manifests
    else if (lowerUrl.includes('.mpd')) {
      addStream(tabId, {
        url: url,
        format: 'mpd (DASH)',
        quality: 'Source Manifest'
      });
    }
    // 3. Intercept direct video media requests (.mp4, .webm, .mkv)
    else if (lowerUrl.includes('.mp4') || lowerUrl.includes('.webm') || lowerUrl.includes('.mkv')) {
      const quality = detectQualityFromUrl(url);
      addStream(tabId, {
        url: url,
        format: lowerUrl.includes('.webm') ? 'webm' : 'mp4',
        quality: quality
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Helper function to check for segment chunk signatures
function isSegmentUrl(url) {
  const segmentKeywords = [
    '.m4s', '.ts', '.aac', 'seg-', 'segment', 'fragment', 'chunk-', 
    'shard-', 'slice-', '/ts/', '/hls-', 'frag-', 'index_', '-video-', '-audio-',
    'init-', 'init.', '/init', '_init'
  ];
  
  // Exclude actual playlist formats
  if (url.includes('.m3u8') || url.includes('.mpd')) {
    return false;
  }
  
  return segmentKeywords.some(keyword => url.includes(keyword));
}

function isInitSegmentUrl(url) {
  const lowerUrl = url.toLowerCase();
  // Check if it's an initialization segment of fMP4 HLS
  return (lowerUrl.includes('init-') || lowerUrl.includes('init.')) && 
         (lowerUrl.includes('.mp4') || lowerUrl.includes('.m4s'));
}

function reconstructM3u8Url(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;
    
    const parts = pathname.split('/');
    parts.pop(); // Remove the init filename
    const newPathname = parts.join('/') + '.m3u8';
    
    parsed.pathname = newPathname;
    return parsed.toString(); // Keeps query parameters (search) and hash
  } catch (e) {
    return null;
  }
}

// Fetch and parse HLS playlist to extract sub-streams/qualities
async function handleHlsInterception(url, tabId) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    const pageTitle = 'Streaming Video';
    
    if (text.includes('#EXT-X-STREAM-INF')) {
      const lines = text.split('\n');
      let currentQuality = 'HLS (Source)';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
          if (resMatch && resMatch[1]) {
            currentQuality = resMatch[1].split('x')[1] + 'p';
          } else {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            if (bwMatch && bwMatch[1]) {
              const mb = (parseInt(bwMatch[1], 10) / 1000000).toFixed(1);
              currentQuality = `${mb} Mbps`;
            }
          }
        } else if (line && !line.startsWith('#')) {
          const absoluteUrl = resolveAbsoluteUrl(url, line);
          
          addStream(tabId, {
            url: absoluteUrl,
            format: 'm3u8 (HLS)',
            quality: currentQuality
          });
        }
      }
    } else {
      addStream(tabId, {
        url: url,
        format: 'm3u8 (HLS)',
        quality: 'Source'
      });
    }
  } catch (e) {
    addStream(tabId, {
      url: url,
      format: 'm3u8 (HLS)',
      quality: 'Playlist'
    });
  }
}

// Add detected stream to memory map and notify desktop app
function addStream(tabId, stream) {
  if (typeof tabId !== 'number' || tabId <= 0) {
    console.warn('addStream called with invalid tabId:', tabId);
    return;
  }

  if (!tabStreams.has(tabId)) {
    tabStreams.set(tabId, []);
  }
  
  const list = tabStreams.get(tabId);
  if (list.some(s => s.url === stream.url)) return;
  
  list.unshift(stream);
  if (list.length > 20) list.pop();

  try {
    chrome.tabs.get(tabId, (tab) => {
      // Access lastError to prevent uncaught chrome extension errors
      if (chrome.runtime.lastError) {
        console.warn('Error fetching tab info:', chrome.runtime.lastError.message);
      }
      
      const title = tab?.title || 'Streaming Video';
      stream.title = title;
      
      sendMediaToAether(stream, tab?.url);
    });
  } catch (err) {
    console.error('Synchronous error calling chrome.tabs.get:', err);
    stream.title = 'Streaming Video';
    sendMediaToAether(stream, '');
  }
}

// Answer query requests from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_STREAMS') {
    const tabId = sender.tab?.id;
    if (tabId && tabStreams.has(tabId)) {
      sendResponse({ streams: tabStreams.get(tabId) });
    } else {
      sendResponse({ streams: [] });
    }
    // No 'return true' since we call sendResponse synchronously
  }
  
  if (message.type === 'TRIGGER_DESKTOP_DOWNLOAD') {
    sendToAether(message.url, sender.tab?.url, message.title);
    sendResponse({ success: true });
  }
});

// Clean up streams when a tab is closed or updated
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStreams.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabStreams.delete(tabId);
  }
});

// Helper utilities
function getUrlExtension(url) {
  try {
    const path = new URL(url).pathname;
    const parts = path.split('/');
    const lastPart = parts[parts.length - 1];
    const extMatch = lastPart.match(/\.([a-zA-Z0-9*]+)$/);
    return extMatch ? extMatch[1].toUpperCase() : '';
  } catch (e) {
    return '';
  }
}

function getFileExtension(filename) {
  if (!filename) return '';
  try {
    const parts = filename.split(/[\\/]/);
    const lastPart = parts[parts.length - 1];
    const extMatch = lastPart.match(/\.([a-zA-Z0-9*]+)$/);
    return extMatch ? extMatch[1].toUpperCase() : '';
  } catch (e) {
    return '';
  }
}

function detectQualityFromUrl(url) {
  const match = url.match(/(_|-|\/|index=)(1080p?|720p?|480p?|360p?|240p?|1080|720|480|360)/i);
  if (match) {
    let q = match[2];
    if (!q.endsWith('p')) q += 'p';
    return q;
  }
  return 'Source';
}

function resolveAbsoluteUrl(base, relative) {
  try {
    return new URL(relative, base).toString();
  } catch (e) {
    return relative;
  }
}

function sendToAether(url, referrer, title) {
  const headers = {};
  if (referrer) {
    headers['Referer'] = referrer;
  }
  headers['User-Agent'] = navigator.userAgent;

  fetch(`${LOCAL_SERVER}/download`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, headers, title })
  })
  .catch(err => console.error('AetherDownload unreachable.', err));
}

function sendMediaToAether(media, tabUrl) {
  const headers = {
    'Referer': tabUrl || ''
  };
  headers['User-Agent'] = navigator.userAgent;

  fetch(`${LOCAL_SERVER}/media-detected`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: media.url,
      title: media.title || 'Streaming Media',
      format: media.format,
      quality: media.quality,
      headers: headers
    })
  })
  .catch(err => console.error('Failed to notify local server of media:', err));
}

function isSupportedProtocol(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://') || lowerUrl.startsWith('ftp://');
}
