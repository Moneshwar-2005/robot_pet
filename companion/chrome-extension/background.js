/**
 * Kuro Companion — Chrome Active Tab Service Worker (Manifest V3)
 *
 * Privacy Guarantees:
 * - Only extracts `hostname` and `title` of the actively focused tab.
 * - Does not read page DOM, form values, cookies, or history.
 * - Ignores localhost, authentication, and banking domains automatically.
 * - Respects user opt-in and temporary pause settings.
 */

const COMPANION_URL = 'http://127.0.0.1:48199/api/browser/tab';

const DEFAULT_EXCLUDED = [
  'localhost',
  '127.0.0.1',
  'accounts.google.com',
  'login.',
  'auth.',
  'paypal.com',
  'bank',
];

async function shouldProcessTab(urlStr, excludedList = []) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false; // Ignore chrome://, chrome-extension://, file://, about:
    }
    const host = parsed.hostname.toLowerCase();
    for (const pattern of DEFAULT_EXCLUDED) {
      if (host.includes(pattern)) return false;
    }
    for (const userExclusion of excludedList) {
      if (userExclusion && host.includes(userExclusion.toLowerCase())) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function reportActiveTab() {
  try {
    const data = await chrome.storage.local.get([
      'kuroTrackingEnabled',
      'excludedDomains',
      'pausedUntil',
      'companionToken',
    ]);

    if (!data.kuroTrackingEnabled) return;

    if (data.pausedUntil && Date.now() < data.pausedUntil) return;

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.url) return;

    const excluded = data.excludedDomains || [];
    const isAllowed = await shouldProcessTab(activeTab.url, excluded);
    if (!isAllowed) return;

    const parsed = new URL(activeTab.url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const cleanTitle = (activeTab.title || '').slice(0, 60);

    const payload = {
      hostname,
      title: cleanTitle,
      timestamp: Date.now(),
    };

    const headers = { 'Content-Type': 'application/json' };
    if (data.companionToken) {
      headers['Authorization'] = `Bearer ${data.companionToken}`;
    }

    await fetch(COMPANION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }).catch(() => {
      // Companion server may be offline; silently ignore network errors
    });
  } catch {
    // Non-fatal
  }
}

// Listen to active tab changes
chrome.tabs.onActivated.addListener(() => {
  reportActiveTab();
});

// Listen to navigation updates in current active tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === 'complete') {
    reportActiveTab();
  }
});
