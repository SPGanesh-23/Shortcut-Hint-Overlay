// ── Key rendering (ported from content.js renderKeyCombo) ───────────────
// The popup used to split keys only on "+", so sequences ("G, D",
// "Tab then Q") and alternatives ("S or /", "K / Space") rendered as one
// big <kbd>. This is the same parser the overlay uses, so both surfaces
// now render identically.
// Parses "+", " / " / " or " (alternatives), and " then " / ", " (sequences).
function renderKeyCombo(rawKeys) {
  const container = document.createElement("span");
  container.classList.add("keys", "key-combo");
  if (!rawKeys) return container;

  const str = rawKeys.trim();

  function buildComboGroup(comboStr) {
    let keys = [];
    if (comboStr === "Ctrl + +" || comboStr === "Ctrl++") {
      keys = ["Ctrl", "+"];
    } else if (comboStr === "+") {
      keys = ["+"];
    } else if (comboStr.endsWith(" + +") || comboStr.endsWith("++")) {
      const prefix = comboStr.replace(/(\s*\+\s*\+|\+\+)$/, "");
      keys = prefix.split(/\s*\+\s*/).filter(Boolean);
      keys.push("+");
    } else {
      keys = comboStr.split(/\s*\+\s*/).filter(Boolean);
    }

    const fragment = document.createDocumentFragment();
    keys.forEach((k, idx) => {
      if (idx > 0) {
        const sep = document.createElement("span");
        sep.classList.add("key-sep");
        sep.textContent = "+";
        fragment.appendChild(sep);
      }
      const kbd = document.createElement("kbd");
      kbd.textContent = k.trim();
      fragment.appendChild(kbd);
    });
    return fragment;
  }

  const altParts = str.split(/\s+\/\s+|\s+or\s+/i);
  if (altParts.length > 1) {
    altParts.forEach((part, idx) => {
      if (idx > 0) {
        const sep = document.createElement("span");
        sep.classList.add("key-sep", "key-sep-or");
        sep.textContent = "or";
        container.appendChild(sep);
      }
      const grp = document.createElement("span");
      grp.classList.add("key-group");
      grp.appendChild(buildComboGroup(part));
      container.appendChild(grp);
    });
    return container;
  }

  const seqParts = str.split(/\s+then\s+|\s*,\s*/i);
  if (seqParts.length > 1) {
    seqParts.forEach((part, idx) => {
      if (idx > 0) {
        const sep = document.createElement("span");
        sep.classList.add("key-sep", "key-sep-then");
        sep.textContent = "→";
        container.appendChild(sep);
      }
      const grp = document.createElement("span");
      grp.classList.add("key-group");
      grp.appendChild(buildComboGroup(part));
      container.appendChild(grp);
    });
    return container;
  }

  container.appendChild(buildComboGroup(str));
  return container;
}

document.addEventListener("DOMContentLoaded", async () => {
  const content = document.getElementById("content");
  const siteToggleRow = document.getElementById("site-toggle-row");
  const siteToggleLabel = document.getElementById("site-toggle-label");
  const siteToggle = document.getElementById("site-toggle");
  const settingsLink = document.getElementById("settings-link");

  // Settings link → open the full options page
  settingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  try {
    // Get the current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.url) {
      content.innerHTML = '<div class="message">Cannot read this page.</div>';
      return;
    }

    const url = new URL(tab.url);
    const host = url.hostname;
    // Same canonical normaliser as content.js / options.js: lowercase and
    // strip a single leading www. / en. / m. prefix.
    const normalizeHost = (h) => (h || "").toLowerCase().replace(/^(www|en|m)\./, "");
    // Path-aware site key (v0.1.10): Docs, Sheets and Slides documents all
    // live on docs.google.com and differ only by path, so a spreadsheet
    // (docs.google.com/spreadsheets/…) must resolve to sheets.google.com,
    // not docs.google.com — same fix as content.js resolveSiteKey().
    const resolveSiteKey = (hostname, pathname) => {
      const clean = normalizeHost(hostname);
      if (clean === "docs.google.com") {
        if ((pathname || "").startsWith("/spreadsheets/")) return "sheets.google.com";
        if ((pathname || "").startsWith("/presentation/")) return "slides.google.com";
        return "docs.google.com";
      }
      return clean;
    };
    const siteKey = resolveSiteKey(host, url.pathname);

    // ── Site disable toggle ───────────────────────────────────────────────
    const DEFAULTS = {
      enabled: true,
      longPressDuration: 500,
      triggerKey: "Control",
      lockCombo: "ctrlSpace",
      disabledSites: [],
      theme: "auto"
    };

    const settings = await chrome.storage.sync.get(DEFAULTS);
    const theme = settings.theme || "auto";
    if (theme === "light" || theme === "dark") {
      document.body.setAttribute("data-theme", theme);
    } else {
      document.body.removeAttribute("data-theme");
    }

    const disabledSites = (settings.disabledSites || []).map(normalizeHost);
    const siteDisabled = disabledSites.includes(siteKey);

    siteToggleLabel.textContent = `Enabled on ${siteKey}`;
    siteToggle.checked = !siteDisabled;
    siteToggleRow.style.display = "flex";

    siteToggle.addEventListener("change", async () => {
      const current = await chrome.storage.sync.get(DEFAULTS);
      // Normalise stored entries too, so a legacy "en.wikipedia.org" entry
      // is removed when re-enabling "wikipedia.org" (and vice versa).
      let sites = (current.disabledSites || []).map(normalizeHost);

      if (siteToggle.checked) {
        // Remove from disabled list (enable on this site)
        sites = sites.filter(s => s !== siteKey);
        siteToggleLabel.textContent = `Enabled on ${siteKey}`;
      } else {
        // Add to disabled list (disable on this site)
        if (!sites.includes(siteKey)) {
          sites.push(siteKey);
        }
        siteToggleLabel.textContent = `Disabled on ${siteKey}`;
      }

      await chrome.storage.sync.set({ disabledSites: sites });
    });

    // Update label text on initial state
    if (siteDisabled) {
      siteToggleLabel.textContent = `Disabled on ${siteKey}`;
    }

    // ── Shortcuts display ─────────────────────────────────────────────────
    const res = await fetch(chrome.runtime.getURL("shortcuts-db.json"));
    const shortcutsDb = await res.json();

    const dbEntry = shortcutsDb[siteKey];
    
    if (!dbEntry) {
      content.innerHTML = '<div class="message">No curated shortcuts for this site yet.<br><br>Long-press <b>Ctrl</b> on the page to see auto-detected ones!</div>';
      return;
    }

    let dbShortcuts = [];
    let dbNote = null;
    
    if (Array.isArray(dbEntry)) {
      dbShortcuts = dbEntry;
    } else if (dbEntry && typeof dbEntry === "object") {
      dbShortcuts = dbEntry.shortcuts || [];
      dbNote = dbEntry.note || null;
    }

    content.innerHTML = ""; // clear loading
    
    // Build the section
    const section = document.createElement("div");
    
    const sLabel = document.createElement("div");
    sLabel.classList.add("section-label");
    sLabel.textContent = siteKey.toUpperCase();
    section.appendChild(sLabel);

    if (dbNote) {
      const noteEl = document.createElement("div");
      noteEl.classList.add("section-note");
      noteEl.textContent = dbNote;
      section.appendChild(noteEl);
    }

    const list = document.createElement("div");
    // Sort by priority if available
    dbShortcuts.sort((a, b) => {
      const pa = (typeof a.priority === 'number') ? a.priority : Infinity;
      const pb = (typeof b.priority === 'number') ? b.priority : Infinity;
      return pa - pb;
    });

    for (const sc of dbShortcuts) {
      const row = document.createElement("div");
      row.classList.add("shortcut-row");

      const labelSpan = document.createElement("span");
      labelSpan.classList.add("label");
      labelSpan.textContent = sc.label;

      const keysSpan = renderKeyCombo(sc.keys);

      row.appendChild(labelSpan);
      row.appendChild(keysSpan);
      list.appendChild(row);
    }

    section.appendChild(list);
    content.appendChild(section);

  } catch (err) {
    console.error(err);
    content.innerHTML = '<div class="message">Cannot display shortcuts here.</div>';
  }
});
