const DEFAULTS = {
  enabled: true,
  longPressDuration: 500,
  triggerKey: "Control",
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

  function addSite(hostname) {
    if (!hostname) return;
    let site = normalizeHost(hostname);
    try {
      // Basic extraction if user pastes full URL
      if (site.startsWith('http')) {
        site = normalizeHost(new URL(site).hostname);
      }
    } catch(e) {}

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
