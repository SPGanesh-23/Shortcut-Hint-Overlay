const DEFAULTS = {
  enabled: true,
  longPressDuration: 500,
  triggerKey: "Control",
  triggerMode: "release",
  lockCombo: "ctrlSpace",
  disabledSites: [],
  overlayPosition: "bottom-right",
  theme: "auto",
  showGlobalShortcuts: true
};

document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle = document.getElementById('enabled-toggle');
  const durationSlider = document.getElementById('duration-slider');
  const durationDisplay = document.getElementById('duration-display');
  const triggerKeySelect = document.getElementById('trigger-key');
  const triggerModeSelect = document.getElementById('trigger-mode');
  const lockComboSelect = document.getElementById('lock-combo');
  const overlayPositionSelect = document.getElementById('overlay-position');
  const themeSelect = document.getElementById('theme-select');
  const globalShortcutsToggle = document.getElementById('global-shortcuts-toggle');
  const disabledSitesList = document.getElementById('disabled-sites-list');
  const newSiteInput = document.getElementById('new-site-input');
  const addSiteBtn = document.getElementById('add-site-btn');
  const addCurrentSiteBtn = document.getElementById('add-current-site-btn');
  const toast = document.getElementById('toast');

  let currentSettings = { ...DEFAULTS };
  let saveTimeout;

  function showToast() {
    toast.classList.add('show');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  function applyOptionsTheme(theme) {
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function saveSettings(newValues) {
    currentSettings = { ...currentSettings, ...newValues };
    chrome.storage.sync.set(currentSettings, () => {
      showToast();
    });
  }

  function renderSites() {
    disabledSitesList.innerHTML = '';
    currentSettings.disabledSites.forEach((site) => {
      const li = document.createElement('li');
      li.textContent = site;
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-site-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        const newSites = currentSettings.disabledSites.filter(s => s !== site);
        saveSettings({ disabledSites: newSites });
        renderSites();
      });
      
      li.appendChild(removeBtn);
      disabledSitesList.appendChild(li);
    });
  }

  // Same canonical normaliser as content.js / popup.js: lowercase and
  // strip a single leading www. / en. / m. prefix.
  function normalizeHost(hostname) {
    return (hostname || "").trim().toLowerCase().replace(/^(www|en|m)\./, '');
  }

  // Subdomain routing (v0.1.10): same allowlist as content.js / popup.js,
  // so disabling "acme.slack.com" here stores "slack.com" and actually
  // disables the workspace. See content.js for why it is an explicit
  // allowlist and not a blanket suffix rule.
  const SUBDOMAIN_ROUTES = {
    ".slack.com": "slack.com",
    ".zendesk.com": "zendesk.com",
    ".freshdesk.com": "freshdesk.com",
    ".salesforce.com": "salesforce.com",
    ".lightning.force.com": "salesforce.com",
    ".my.salesforce.com": "salesforce.com",
    ".hubspot.com": "hubspot.com",
    ".atlassian.net": "atlassian.net",
    ".wikipedia.org": "wikipedia.org",
    ".myshopify.com": "shopify.com",
    ".asana.com": "asana.com",
    ".monday.com": "monday.com",
    ".clickup.com": "clickup.com",
    ".basecamp.com": "basecamp.com",
    ".shopify.com": "shopify.com",
    ".discord.com": "discord.com",
    ".cloud.microsoft": "office.com",
  };
  const HOST_ALIASES = {
    "outlook.office.com": "outlook.com",
    "outlook.live.com": "outlook.com",
    "mail.proton.me": "proton.me",
    "chat.openai.com": "chatgpt.com",
    "old.reddit.com": "reddit.com",
    "gist.github.com": "github.com",
    "app.zoom.us": "zoom.us",
    "notion.site": "notion.so",
    "cdpn.io": "codepen.io",
    "amazon.in": "amazon.com",
    "amazon.co.uk": "amazon.com",
    "amazon.de": "amazon.com",
    "amazon.ca": "amazon.com",
    "amazon.com.au": "amazon.com",
    "amazon.co.jp": "amazon.com",
  };
  function resolveSiteKey(hostname, pathname) {
    const clean = normalizeHost(hostname);
    if (clean === "docs.google.com") {
      if ((pathname || "").startsWith("/spreadsheets/")) return "sheets.google.com";
      if ((pathname || "").startsWith("/presentation/")) return "slides.google.com";
      return "docs.google.com";
    }
    if (HOST_ALIASES[clean]) return HOST_ALIASES[clean];
    let best = null;
    for (const suffix of Object.keys(SUBDOMAIN_ROUTES)) {
      if (clean.endsWith(suffix) && (!best || suffix.length > best.length)) best = suffix;
    }
    if (best) return SUBDOMAIN_ROUTES[best];
    return clean;
  }

  function addSite(hostname) {
    if (!hostname) return;
    let site = normalizeHost(hostname);
    let pathname = "";
    try {
      // Basic extraction if user pastes full URL
      if (site.startsWith('http')) {
        const url = new URL(site);
        site = normalizeHost(url.hostname);
        pathname = url.pathname || "";
      }
    } catch(e) {}

    // Resolve to the DB key (workspace subdomain / Workspace path), so
    // the stored entry matches what content.js checks.
    site = resolveSiteKey(site, pathname);

    // Normalise stored entries too, so a legacy "en.wikipedia.org" entry
    // does not sit alongside (and fail to match) "wikipedia.org".
    const normalised = (currentSettings.disabledSites || []).map(normalizeHost);
    if (site && !normalised.includes(site)) {
      const newSites = [...normalised, site];
      saveSettings({ disabledSites: newSites });
      renderSites();
    }
  }

  // Load initial settings
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    currentSettings = settings;
    
    enabledToggle.checked = settings.enabled;
    
    durationSlider.value = settings.longPressDuration;
    durationDisplay.textContent = `${settings.longPressDuration}ms`;
    
    triggerKeySelect.value = settings.triggerKey;
    triggerModeSelect.value = settings.triggerMode === "peek" ? "peek" : "release";
    lockComboSelect.value = settings.lockCombo;
    overlayPositionSelect.value = settings.overlayPosition || "bottom-right";
    themeSelect.value = settings.theme || "auto";
    globalShortcutsToggle.checked = settings.showGlobalShortcuts !== undefined ? settings.showGlobalShortcuts : true;
    applyOptionsTheme(settings.theme || "auto");
    
    renderSites();
  });

  // Event Listeners
  enabledToggle.addEventListener('change', (e) => {
    saveSettings({ enabled: e.target.checked });
  });

  durationSlider.addEventListener('input', (e) => {
    durationDisplay.textContent = `${e.target.value}ms`;
  });

  durationSlider.addEventListener('change', (e) => {
    saveSettings({ longPressDuration: parseInt(e.target.value, 10) });
  });

  triggerKeySelect.addEventListener('change', (e) => {
    saveSettings({ triggerKey: e.target.value });
  });

  triggerModeSelect.addEventListener('change', (e) => {
    saveSettings({ triggerMode: e.target.value });
  });

  lockComboSelect.addEventListener('change', (e) => {
    saveSettings({ lockCombo: e.target.value });
  });

  overlayPositionSelect.addEventListener('change', (e) => {
    saveSettings({ overlayPosition: e.target.value });
  });

  themeSelect.addEventListener('change', (e) => {
    saveSettings({ theme: e.target.value });
    applyOptionsTheme(e.target.value);
  });

  globalShortcutsToggle.addEventListener('change', (e) => {
    saveSettings({ showGlobalShortcuts: e.target.checked });
  });

  addSiteBtn.addEventListener('click', () => {
    addSite(newSiteInput.value);
    newSiteInput.value = '';
  });

  newSiteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSite(newSiteInput.value);
      newSiteInput.value = '';
    }
  });

  addCurrentSiteBtn.addEventListener('click', () => {
    // The options page runs in its own tab, so "active tab" is us (chrome-extension://).
    // Instead, find the most recent http/https tab in this window.
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      // Find the last tab with an http(s) URL (skip the options page itself)
      const siteTabs = (tabs || []).filter(t => {
        try {
          return t.url && new URL(t.url).protocol.startsWith('http');
        } catch { return false; }
      });
      
      if (siteTabs.length === 0) {
        addCurrentSiteBtn.textContent = 'No site tab found';
        setTimeout(() => { addCurrentSiteBtn.textContent = 'Add current site'; }, 2000);
        return;
      }
      
      // Prefer the tab that was most recently active (highest index near the options tab)
      // Chrome sorts query results by index, so pick the last active http tab
      const activeTab = siteTabs.find(t => t.active) || siteTabs[siteTabs.length - 1];
      const hostname = new URL(activeTab.url).hostname;
      addSite(hostname);
    });
  });
});
