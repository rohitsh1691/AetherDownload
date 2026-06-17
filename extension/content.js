// Monitor Del key bypass
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete') {
    chrome.storage.local.set({ bypassActive: true });
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Delete') {
    chrome.storage.local.set({ bypassActive: false });
  }
});

// Periodic video player scanning
setInterval(detectVideoPlayers, 2000);

let floatingPanel = null;
let activeVideo = null;

// Helper to recursively find video elements inside shadow DOMs
function findVideos(root = document) {
  let videos = Array.from(root.querySelectorAll('video'));
  
  // Recursively search in shadow roots of all elements
  try {
    const allElements = root.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el.shadowRoot) {
        videos = videos.concat(findVideos(el.shadowRoot));
      }
    }
  } catch (e) {
    // Fail-safe for permission or element errors
  }
  return videos;
}

function detectVideoPlayers() {
  const videos = findVideos();
  if (videos.length === 0) {
    removeFloatingPanel();
    return;
  }

  // Find the video element currently visible and playing or ready
  let primaryVideo = null;
  for (const video of videos) {
    if (video.offsetWidth > 100 && video.offsetHeight > 100) {
      primaryVideo = video;
      break;
    }
  }

  if (!primaryVideo) {
    removeFloatingPanel();
    return;
  }

  activeVideo = primaryVideo;
  injectFloatingPanel(primaryVideo);
}

function injectFloatingPanel(video) {
  if (floatingPanel) {
    repositionPanel(video);
    return;
  }

  floatingPanel = document.createElement('div');
  floatingPanel.id = 'aether-grabber-panel';
  floatingPanel.innerHTML = `
    <button id="aether-grabber-btn">
      <svg class="aether-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Download this video
    </button>
    <div id="aether-grabber-dropdown" class="aether-hide"></div>
  `;

  document.body.appendChild(floatingPanel);
  repositionPanel(video);

  const btn = document.getElementById('aether-grabber-btn');
  const dropdown = document.getElementById('aether-grabber-dropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('aether-hide');
    
    // Close all other dropdowns
    document.querySelectorAll('#aether-grabber-dropdown').forEach(d => d.classList.add('aether-hide'));
    
    if (isHidden) {
      dropdown.classList.remove('aether-hide');
      populateDropdown(dropdown);
    }
  });

  // Close dropdown on click outside
  document.addEventListener('click', () => {
    dropdown?.classList.add('aether-hide');
  });
}

function populateDropdown(dropdown) {
  dropdown.innerHTML = `<div class="aether-dropdown-item no-streams">Scanning stream qualities...</div>`;
  
  // Ask background worker for intercepted streams of the current tab
  chrome.runtime.sendMessage({ type: 'GET_TAB_STREAMS' }, (response) => {
    if (!response || !response.streams || response.streams.length === 0) {
      dropdown.innerHTML = `<div class="aether-dropdown-item no-streams">No qualities intercepted yet.<br><small>Play the video to capture streams</small></div>`;
      return;
    }

    dropdown.innerHTML = '';
    
    response.streams.forEach(stream => {
      const item = document.createElement('div');
      item.className = 'aether-dropdown-item';
      
      // Separate format and quality badge UI
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="aether-stream-format">${stream.format.toUpperCase()}</span>
          <span style="font-size: 10px; background-color: rgba(99, 102, 241, 0.2); padding: 1px 6px; border-radius: 4px; color: #818cf8; font-weight: 700;">
            ${stream.quality}
          </span>
        </div>
        <span class="aether-stream-url">${stream.url.substring(0, 45)}...</span>
      `;
      
      item.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'TRIGGER_DESKTOP_DOWNLOAD',
          url: stream.url,
          title: stream.title
        });
        dropdown.classList.add('aether-hide');
      });
      dropdown.appendChild(item);
    });
  });
}

function repositionPanel(video) {
  if (!floatingPanel) return;
  const rect = video.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Float panel in upper-right corner of the video player
  floatingPanel.style.left = `${rect.left + scrollX + rect.width - 180}px`;
  floatingPanel.style.top = `${rect.top + scrollY + 12}px`;
  
  if (rect.width < 100 || rect.height < 100 || rect.top < 0 && rect.bottom < 0) {
    floatingPanel.style.display = 'none';
  } else {
    floatingPanel.style.display = 'block';
  }
}

function removeFloatingPanel() {
  if (floatingPanel) {
    floatingPanel.remove();
    floatingPanel = null;
  }
}
