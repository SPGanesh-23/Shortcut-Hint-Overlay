// =============================================================================
// Shortcut Hint Overlay — Background Script
// =============================================================================
// Handles gracefully disabling the extension icon on pages where Chrome does
// not allow content scripts to run (e.g. chrome:// pages).
// =============================================================================

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
