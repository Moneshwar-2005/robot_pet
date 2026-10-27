document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggleTracking');
  const activeDomainEl = document.getElementById('activeDomain');
  const btnExclude = document.getElementById('btnExcludeDomain');
  const btnPause = document.getElementById('btnPause30');

  let currentHost = '';

  // Load storage state
  const data = await chrome.storage.local.get([
    'kuroTrackingEnabled',
    'excludedDomains',
    'pausedUntil',
  ]);

  toggle.checked = Boolean(data.kuroTrackingEnabled);

  // Check current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      currentHost = url.hostname.replace(/^www\./, '');
      activeDomainEl.textContent = currentHost || 'None (internal page)';
    } catch {
      activeDomainEl.textContent = 'None';
    }
  }

  // Toggle switch handler
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ kuroTrackingEnabled: toggle.checked });
  });

  // Exclude domain button
  btnExclude.addEventListener('click', async () => {
    if (!currentHost) return;
    const res = await chrome.storage.local.get(['excludedDomains']);
    const list = res.excludedDomains || [];
    if (!list.includes(currentHost)) {
      list.push(currentHost);
      await chrome.storage.local.set({ excludedDomains: list });
      alert(`Excluded "${currentHost}" from Kuro context awareness.`);
    }
  });

  // Pause button
  btnPause.addEventListener('click', async () => {
    const until = Date.now() + 30 * 60 * 1000;
    await chrome.storage.local.set({ pausedUntil: until });
    alert('Kuro browser awareness paused for 30 minutes.');
  });
});
