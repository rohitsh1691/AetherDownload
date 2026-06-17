const LOCAL_SERVER = 'http://localhost:9654';

document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('status-badge');
  const desktopStatus = document.getElementById('desktop-status');
  const interceptCheckbox = document.getElementById('intercept-checkbox');

  // Load current interception setting
  chrome.storage.local.get(['interceptAll'], (res) => {
    interceptCheckbox.checked = res.interceptAll !== false;
  });

  // Handle setting updates
  interceptCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ interceptAll: interceptCheckbox.checked });
  });

  // Verify connection to local server
  fetch(`${LOCAL_SERVER}/detected-media`, { method: 'GET', mode: 'cors' })
    .then(res => {
      if (res.ok) {
        statusBadge.textContent = 'Active';
        statusBadge.className = 'badge online';
        desktopStatus.textContent = 'Running';
        desktopStatus.className = 'connection-status online';
      } else {
        throw new Error('Unreachable');
      }
    })
    .catch(err => {
      statusBadge.textContent = 'Inactive';
      statusBadge.className = 'badge offline';
      desktopStatus.textContent = 'Offline';
      desktopStatus.className = 'connection-status';
    });
});
