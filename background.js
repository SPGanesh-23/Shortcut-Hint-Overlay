// =============================================================================
// Shortcut Hint Overlay — Background Script
// =============================================================================
// Handles gracefully disabling the extension icon on pages where Chrome does
// not allow content scripts to run (e.g. chrome:// pages).
// =============================================================================

// Serve the shortcuts DB to content scripts (v0.1.8). A content script's
// direct fetch() of the DB is blocked by strict page CSPs (e.g.
// accounts.google.com, which logged "Failed to load shortcuts-db:
// TypeError: Failed to fetch" on the Errors page). The service worker's
// fetch is not subject to any page's CSP, so content scripts ask here
// instead. The DB is fetched once and cached for the worker's lifetime.
let shortcutsDbPromise = null;
function getShortcutsDb() {
  if (!shortcutsDbPromise) {
    shortcutsDbPromise = fetch(chrome.runtime.getURL("shortcuts-db.json"))
      .then((r) => r.json())
      .catch(() => {
        shortcutsDbPromise = null; // let a later request retry
        return null;
      });
  }
  return shortcutsDbPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "get-shortcuts-db") {
    getShortcutsDb().then(sendResponse);
    return true; // async response
  }
  return false;
});

// Onboarding: on first install, open the welcome page once so new users
// learn the trigger (hold Ctrl) instead of having to discover it by luck.
// Updates do not re-open it.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab && tab.url) {
    updateIcon(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.id) {
      updateIcon(tab.id, tab.url);
    }
  } catch (err) {
    // Tab may have been closed or unavailable before it could be inspected
  }
});

async function updateIcon(tabId, url) {
  try {
    // If we don't have a URL, or it's a restricted scheme, disable the icon.
    // (Chrome strips the url property if we don't have permissions for it,
    // which happens on chrome:// pages even with <all_urls>).
    if (!url || 
        url.startsWith("chrome://") || 
        url.startsWith("chrome-extension://") || 
        url.startsWith("edge://") || 
        url.startsWith("about:") || 
        url.startsWith("https://chrome.google.com/webstore")) {
      await chrome.action.disable(tabId);
    } else {
      await chrome.action.enable(tabId);
    }
  } catch (err) {
    // Ignore errors if the tab no longer exists
  }
}
