// =============================================================================
// Shortcut Hint Overlay — Content Script (Phase 1 + Phase 2)
// =============================================================================
// Injected into every normal web page. Detects a long-press of the Ctrl key
// (~500 ms hold) and, on release, shows a Shadow DOM overlay listing
// keyboard shortcuts. Triggering on release (not on hold) means ordinary
// Ctrl+click / Ctrl+scroll / Ctrl+C never pops the overlay up: any click,
// scroll or other key during the hold disqualifies it.
// Phase 1: Global Chrome shortcuts (always shown).
// Phase 2: DOM auto-detection of [accesskey] and [aria-keyshortcuts] elements.
// =============================================================================

(() => {
  "use strict";

  // ── Settings (defaults, overwritten by chrome.storage.sync on bootstrap) ────
  const SETTINGS_DEFAULTS = {
    enabled: true,
    longPressDuration: 500,
    triggerKey: "Control",
    // v0.1.12: how the long-press opens the overlay. "release" (default)
    // opens it locked when the key is released after a clean hold, so
    // ordinary Ctrl+click / Ctrl+scroll / Ctrl+C never trigger it.
    // "peek" is the pre-v0.1.11 behaviour: the overlay appears while the
    // key is held and hides on release (Ctrl+Space locks it).
    triggerMode: "release",
    lockCombo: "ctrlSpace",
    disabledSites: [],
    overlayPosition: "bottom-right",
    theme: "auto",
    showGlobalShortcuts: true
  };

  let longPressDuration = SETTINGS_DEFAULTS.longPressDuration;
  let triggerKey = SETTINGS_DEFAULTS.triggerKey;
  let triggerMode = SETTINGS_DEFAULTS.triggerMode;
  let lockCombo = SETTINGS_DEFAULTS.lockCombo;
  let overlayPosition = SETTINGS_DEFAULTS.overlayPosition;
  let theme = SETTINGS_DEFAULTS.theme;
  let showGlobalShortcuts = SETTINGS_DEFAULTS.showGlobalShortcuts;

  const FADE_DURATION_MS = 150;    // Matches the CSS transition duration

  // ── State ──────────────────────────────────────────────────────────────────
  let pressTimer = null;           // setTimeout handle for the long-press
  // v0.1.11 fix: cancelling the timer once is not enough. While the trigger
  // key stays held, any fresh keydown re-arms the timer, so a Ctrl+scroll
  // only bought ~500 ms before the overlay popped up anyway. Once the user
  // clicks or scrolls with the trigger key held, the long-press stays
  // suppressed for the rest of that hold; it is lifted when the key is
  // released (onKeyUp) or the window blurs.
  let longPressSuppressed = false;
  // v0.1.11 (release trigger): the timer no longer opens the overlay when
  // it fires — it only arms this flag. The overlay opens on release of the
  // trigger key, and only if the hold was clean: no other key, click or
  // scroll in between. That is what makes Ctrl+click / Ctrl+scroll /
  // Ctrl+C safe — those all use the key before releasing it.
  let longPressReady = false;
  let overlayState = 'hidden';     // 'hidden' | 'visible' | 'locked'
  let hostEl = null;               // The <div> we attach the Shadow DOM to
  let shadowRoot = null;           // The shadow root itself
  let panelEl = null;              // The .panel element inside the shadow
  let chromeSectionEl = null;      // Reference to the Chrome shortcuts section
  let pageSectionEl = null;        // Reference to the "This Page" section (or null)
  let emptyStateEl = null;         // Reference to empty state message when both tiers have nothing
  let shortcutsDb = {};            // Curated site-specific shortcuts from JSON
  let listenersAttached = false;   // Whether event listeners are currently active
  let searchInputEl = null;        // The search <input> inside the shadow panel
  let hintEl = null;               // The "Hold Ctrl…" hint in the panel header

  let searchEmptyEl = null;        // "No shortcuts match …" element (or null)

  // ── Frames (v0.1.9) ───────────────────────────────────────────────────────
  // Google Docs captures keystrokes in a hidden same-origin iframe, so the
  // top frame never sees them and the overlay never opened inside a
  // document (it worked on the Docs homepage, which has no editor iframe).
  // With "all_frames" in the manifest this script also runs in iframes.
  // A same-origin iframe is a *forwarder*: it sends its key/click events
  // to the top frame, which owns the overlay. Cross-origin iframes and the
  // top frame itself run standalone, as before.
  // Frame role (v0.1.9.2): v0.1.9 tried to run a forwarder inside the
  // editor iframe, but Chrome never injects content scripts into
  // about:blank frames (Docs/Slides' hidden .docs-texteventtarget-iframe)
  // without "match_origin_as_fallback" — so the forwarder never ran and
  // Docs/Slides stayed broken. The top frame now hooks same-origin
  // iframes directly (see hookIframe below), so a same-origin iframe is
  // inert here: the top frame owns its keys. A cross-origin iframe cannot
  // be hooked from the top, so it keeps running standalone with its own
  // overlay, exactly as before.
  const inFrame = typeof window.top !== "undefined" && window.top !== window;
  let topReachable = false;
  try {
    topReachable = inFrame && !!window.top.location.href;
  } catch (err) {
    topReachable = false; // cross-origin: cannot read window.top.location
  }
  const isInertFrame = inFrame && topReachable;
  // Site lookup uses the top frame's hostname when it is readable, so an
  // editor iframe still resolves to its site (e.g. docs.google.com).
  function getSiteHostname() {
    try {
      if (window.top && window.top !== window && window.top.location) {
        return window.top.location.hostname;
      }
    } catch (err) { /* cross-origin: fall through to our own hostname */ }
    return window.location.hostname;
  }
  function getSitePathname() {
    try {
      if (window.top && window.top !== window && window.top.location) {
        return window.top.location.pathname || "";
      }
    } catch (err) { /* cross-origin: fall through to our own pathname */ }
    return window.location.pathname || "";
  }
  // Resolve the DB key for the current page. Hostname alone is not enough:
  // Google Docs, Sheets and Slides documents ALL live on docs.google.com
  // and differ only by path (/document/, /spreadsheets/, /presentation/).
  // Without this, every Workspace document showed Docs shortcuts — a
  // spreadsheet showed "DOCS.GOOGLE.COM" with Insert comment / Dictionary /
  // Word count instead of its own Sheets shortcuts.
  // Subdomain routing (v0.1.10): some apps don't live on their main
  // address — they live on a subdomain per customer or per language, so
  // the DB key never matches (a real Slack workspace is
  // yourteam.slack.com, not slack.com). An explicit allowlist only: a
  // blanket "ends with .X" rule would misfire (outlook.office.com is
  // Outlook, not office.com — it gets an exact alias instead). Longest
  // suffix wins (".my.salesforce.com" before ".salesforce.com").
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
  function resolveSiteKey() {
    const clean = normalizeHost(getSiteHostname());
    if (clean === "docs.google.com") {
      const path = getSitePathname();
      if (path.startsWith("/spreadsheets/")) return "sheets.google.com";
      if (path.startsWith("/presentation/")) return "slides.google.com";
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

  // ── Tier 1: Global Chrome Shortcuts ────────────────────────────────────────
  // Descriptive reference only — the extension can't trigger or intercept these.
  const GLOBAL_SHORTCUTS = [
    { keys: "Ctrl + T",         label: "New tab",                  priority: 1 },
    { keys: "Ctrl + W",         label: "Close current tab",        priority: 2 },
    { keys: "Ctrl + Shift + T", label: "Reopen last closed tab",   priority: 3 },
    { keys: "Ctrl + L",         label: "Focus address bar",        priority: 4 },
    { keys: "Ctrl + F",         label: "Find on page",             priority: 5 },
    { keys: "Ctrl + R",         label: "Reload page",              priority: 6 },
    { keys: "Ctrl + Tab",       label: "Next tab",                 priority: 7 },
    { keys: "Ctrl + Shift + Tab", label: "Previous tab",           priority: 8 },
    { keys: "Ctrl + H",         label: "Open History page",        priority: 9 },
    { keys: "Ctrl + J",         label: "Open Downloads page",      priority: 10 },
    { keys: "Ctrl + D",         label: "Bookmark current page",    priority: 11 },
    { keys: "Ctrl + Shift + B", label: "Toggle bookmarks bar",     priority: 12 },
    { keys: "Ctrl + N",         label: "New window",               priority: 13 },
    { keys: "Ctrl + Shift + N", label: "New incognito window",     priority: 14 },
    { keys: "Ctrl + Shift + I", label: "Open DevTools",            priority: 15 },
    { keys: "Ctrl + Shift + R", label: "Hard reload (bypass cache)", priority: 16 },
    { keys: "Ctrl + +",         label: "Zoom in",                  priority: 17 },
    { keys: "Ctrl + −",         label: "Zoom out",                 priority: 18 },
    { keys: "Ctrl + 0",         label: "Reset zoom",               priority: 19 },
    { keys: "F11",              label: "Toggle fullscreen",        priority: 20 },
    { keys: "Alt + ←",          label: "Back",                     priority: 21 },
    { keys: "Alt + →",          label: "Forward",                  priority: 22 },
    { keys: "Ctrl + Enter",     label: "Add www. & .com to address", priority: 23 },
    { keys: "Alt + Enter",      label: "Open address in new tab",  priority: 24 },
  ];

  // ── Shadow DOM Setup ───────────────────────────────────────────────────────
  // We create a host <div> with a closed Shadow DOM so that:
  //   1. The host page's CSS cannot affect our overlay.
  //   2. Our styles cannot leak into the page.
  // The host element is always present but the panel inside starts hidden
  // (opacity: 0, pointer-events: none) and is revealed via a CSS class.

  function createOverlay() {
    hostEl = document.createElement("div");
    hostEl.id = "shortcut-hint-overlay-host";
    // Ensure the host div itself is invisible / non-intrusive until shown.
    hostEl.style.cssText = "all:initial; position:fixed; z-index:2147483647; top:0; left:0; width:0; height:0; pointer-events:none;";
    document.documentElement.appendChild(hostEl);

    shadowRoot = hostEl.attachShadow({ mode: "closed" });

    // ── Inject styles into the shadow root ─────────────────────────────────
    const style = document.createElement("style");
    style.textContent = getOverlayCSS();
    shadowRoot.appendChild(style);

    // ── Build the panel ────────────────────────────────────────────────────
    panelEl = document.createElement("div");
    panelEl.classList.add("panel");
    // Accessibility: the panel is a dialog, so screen readers announce it
    // as one instead of reading a pile of unrelated divs.
    panelEl.setAttribute("role", "dialog");
    panelEl.setAttribute("aria-label", "Keyboard Shortcuts");
    panelEl.setAttribute("aria-modal", "false");
    applyTheme();
    // Start hidden (CSS default: opacity 0, pointer-events none).

    // Header
    const header = document.createElement("div");
    header.classList.add("header");

    const titleRow = document.createElement("div");
    titleRow.classList.add("title-row");

    const icon = document.createElement("span");
    icon.classList.add("title-icon");
    icon.textContent = "⌨";

    const title = document.createElement("span");
    title.classList.add("title");
    title.textContent = "Keyboard Shortcuts";

    const lockIcon = document.createElement("span");
    lockIcon.classList.add("lock-icon");
    lockIcon.textContent = "🔓";
    lockIcon.title = "Click or press Ctrl+Space to lock open";
    lockIcon.setAttribute("role", "button");
    lockIcon.setAttribute("tabindex", "0");
    lockIcon.setAttribute("aria-label", "Lock overlay open");
    lockIcon.setAttribute("aria-pressed", "false");
    lockIcon.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        setOverlayState(overlayState === 'locked' ? 'visible' : 'locked');
      }
    });

    titleRow.appendChild(icon);
    titleRow.appendChild(title);
    titleRow.appendChild(lockIcon);

    const hint = document.createElement("span");
    hint.classList.add("hint");
    hint.textContent = triggerMode === "peek"
      ? "Hold Ctrl to peek"
      : "Hold Ctrl, then release to open";
    hintEl = hint;

    header.appendChild(titleRow);
    header.appendChild(hint);
    panelEl.appendChild(header);

    // ── Search / filter ──────────────────────────────────────────────────
    // A plain <input> inside the Shadow DOM, so page CSS/JS cannot touch it.
    // Typing only makes sense once the overlay is locked (you cannot type
    // while still holding Ctrl), so focusing/clicking it locks the overlay
    // first — via the panel click handler below and focusSearch() in the
    // key handler. Filtering is live, case-insensitive, and matches both
    // the shortcut keys and its label (e.g. "tab" finds "Ctrl + Tab" and
    // "New tab").
    const searchRow = document.createElement("div");
    searchRow.classList.add("search-row");

    searchInputEl = document.createElement("input");
    searchInputEl.classList.add("search-input");
    searchInputEl.type = "text";
    searchInputEl.placeholder = "Search shortcuts…  ( / to focus )";
    searchInputEl.setAttribute("aria-label", "Search shortcuts");
    searchInputEl.autocomplete = "off";
    searchInputEl.spellcheck = false;
    searchInputEl.addEventListener("input", () => {
      applySearchFilter(searchInputEl.value);
    });
    // Clicking the input must lock the overlay (the panel click handler
    // does this), but must NOT let the click fall through to the page.
    searchInputEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (overlayState === 'visible') setOverlayState('locked');
    });
    searchInputEl.addEventListener("keydown", (e) => {
      // Let the document-level handler deal with Esc / Ctrl+Space, but
      // stop the keystroke reaching the page underneath. Arrow/Home/End
      // keys are left to bubble to the panel, which uses them for row
      // navigation (and stops them there).
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.stopPropagation();
      }
    });

    searchRow.appendChild(searchInputEl);
    panelEl.appendChild(searchRow);

    // Click to lock (if currently just visible)
    panelEl.addEventListener("click", () => {
      if (overlayState === 'visible') {
        setOverlayState('locked');
      }
    });

    // Arrow-key navigation (locked state only): Down / Up walks the
    // visible shortcut rows, Home / End jumps to the first / last row.
    // Roving tabindex: the focused row gets tabindex 0, the rest -1.
    panelEl.addEventListener("keydown", (e) => {
      if (overlayState !== 'locked') return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const rows = getVisibleRows();
      if (rows.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const active = shadowRoot.activeElement;
      let idx = rows.indexOf(active);
      if (e.key === "ArrowDown") idx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1);
      if (e.key === "ArrowUp") idx = idx < 0 ? rows.length - 1 : Math.max(idx - 1, 0);
      if (e.key === "Home") idx = 0;
      if (e.key === "End") idx = rows.length - 1;
      rows.forEach((r) => { r.tabIndex = -1; });
      rows[idx].tabIndex = 0;
      rows[idx].focus();
    });

    shadowRoot.appendChild(panelEl);
  }

  /**
   * Sort shortcuts by priority (ascending). Items without priority are treated as lowest priority.
   * @param {{keys: string, label: string, priority?: number}[]} list
   * @returns {{keys: string, label: string, priority?: number}[]}
   */
  function sortShortcuts(list) {
    return [...list].sort((a, b) => {
      const pa = (typeof a.priority === 'number') ? a.priority : Infinity;
      const pb = (typeof b.priority === 'number') ? b.priority : Infinity;
      return pa - pb;
    });
  }

  /**
   * Parse a raw key string into structured <kbd> chips and separators.
   * Handles "+", " / " (alternatives), and " then " / ", " (sequences).
   * @param {string} rawKeys
   * @returns {HTMLElement}
   */
  function renderKeyCombo(rawKeys) {
    const container = document.createElement("span");
    container.classList.add("key-combo");
    if (!rawKeys) return container;

    const str = rawKeys.trim();

    // Helper to parse a single combo like "Ctrl + Shift + K" or "Ctrl + +"
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
        kbd.classList.add("key");
        kbd.textContent = k.trim();
        fragment.appendChild(kbd);
      });
      return fragment;
    }

    // Check for alternatives " / " or " or " (e.g. "K / Space", "S or /").
    // The old regex only matched " / " with a trailing space, so "S or /"
    // fell through and rendered as one big key.
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

    // Check for sequence " then " or ", "
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

    // Single combo: directly append keys to key-combo
    container.appendChild(buildComboGroup(str));
    return container;
  }

  /**
   * Build a single shortcut row element.
   * @param {{keys: string, label: string}} sc
   * @returns {HTMLElement}
   */
  function createShortcutRow(sc) {
    const row = document.createElement("div");
    row.classList.add("shortcut-row");
    // Accessibility: each row is a list item that a screen reader can read
    // as "keys: label", and it is focusable so arrow-key navigation works.
    // tabindex is -1 (roving tabindex): only the row the user navigated to
    // is in the Tab order, so Tab does not have to step through 30 rows.
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", `${sc.keys}: ${sc.label}`);
    row.tabIndex = -1;

    const keysSpan = renderKeyCombo(sc.keys);

    const labelSpan = document.createElement("span");
    labelSpan.classList.add("label");
    labelSpan.textContent = sc.label;
    labelSpan.title = sc.label; // Native browser tooltip for untruncated label

    row.appendChild(keysSpan);
    row.appendChild(labelSpan);
    return row;
  }

  /**
   * Build a labelled section with a title and a list of shortcut rows.
   * Top 3 shortcuts are shown by default; additional shortcuts are placed
   * in a collapsible scrollable container with a "View more" toggle.
   * @param {string} sectionTitle
   * @param {{keys: string, label: string, priority?: number}[]} shortcuts
   * @param {string|null} note
   * @returns {HTMLElement}
   */
  function buildSection(sectionTitle, shortcuts, note = null) {
    const section = document.createElement("div");
    section.classList.add("section");

    const sLabel = document.createElement("div");
    sLabel.classList.add("section-label");
    sLabel.textContent = sectionTitle;
    section.appendChild(sLabel);

    if (note) {
      const noteEl = document.createElement("div");
      noteEl.classList.add("section-note");
      noteEl.textContent = note;
      section.appendChild(noteEl);
    }

    const sorted = sortShortcuts(shortcuts);
    const topShortcuts = sorted.slice(0, 3);
    const extraShortcuts = sorted.slice(3);

    // Primary list (top 3 shortcuts)
    const list = document.createElement("div");
    list.classList.add("shortcut-list");
    list.setAttribute("role", "list");
    for (const sc of topShortcuts) {
      list.appendChild(createShortcutRow(sc));
    }
    section.appendChild(list);

    // If more than 3, add extra scrollable container & toggle button
    if (extraShortcuts.length > 0) {
      const extraContainer = document.createElement("div");
      extraContainer.classList.add("extra-shortcuts");
      extraContainer.style.display = "none"; // Collapsed by default
      extraContainer.id = `extra-${sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

      const extraList = document.createElement("div");
      extraList.classList.add("shortcut-list", "extra-list");
      extraList.setAttribute("role", "list");
      for (const sc of extraShortcuts) {
        extraList.appendChild(createShortcutRow(sc));
      }
      extraContainer.appendChild(extraList);
      section.appendChild(extraContainer);

      const toggleBtn = document.createElement("button");
      toggleBtn.classList.add("toggle-more-btn");
      toggleBtn.type = "button";
      toggleBtn.textContent = `View more (${extraShortcuts.length})`;
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.setAttribute("aria-controls", extraContainer.id);

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCollapsed = extraContainer.style.display === "none";
        if (isCollapsed) {
          extraContainer.style.display = "block";
          toggleBtn.textContent = "Show less";
          toggleBtn.classList.add("expanded");
          toggleBtn.setAttribute("aria-expanded", "true");
        } else {
          extraContainer.style.display = "none";
          toggleBtn.textContent = `View more (${extraShortcuts.length})`;
          toggleBtn.classList.remove("expanded");
          toggleBtn.setAttribute("aria-expanded", "false");
        }

        // Re-clamp position if the panel expanded near the screen bottom/edges
        if (panelEl) {
          const rect = panelEl.getBoundingClientRect();
          const clamped = clampPosition(rect.left, rect.top, rect.width, rect.height);
          panelEl.style.left = clamped.x + "px";
          panelEl.style.top = clamped.y + "px";
        }
      });

      section.appendChild(toggleBtn);
    }

    return section;
  }

  // ── CSS (lives inside Shadow DOM) ──────────────────────────────────────────

  function getOverlayCSS() {
    return /* css */ `
      :host {
        /* Ensure the host is inert so it never intercepts clicks on the page */
        pointer-events: none !important;
      }

      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .panel {
        /* ── Positioning (set dynamically by JS) ───────── */
        position: fixed;
        max-height: calc(100vh - 48px);
        width: 380px;
        overflow-y: auto;

        /* ── Appearance ─────────────────────────────────── */
        background: rgba(18, 18, 22, 0.92);
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.45),
          0 2px 8px rgba(0, 0, 0, 0.25),
          inset 0 0.5px 0 rgba(255, 255, 255, 0.06);
        color: #e4e4e8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                     "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.5;

        /* ── Fade in / out ──────────────────────────────── */
        opacity: 0;
        pointer-events: none;
        transition:
          opacity ${FADE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1);

        /* ── Scrollbar styling ──────────────────────────── */
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.15) transparent;
      }

      .panel::-webkit-scrollbar {
        width: 5px;
      }
      .panel::-webkit-scrollbar-track {
        background: transparent;
      }
      .panel::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.12);
        border-radius: 4px;
      }

      .panel.visible {
        opacity: 1;
        pointer-events: auto;
      }

      /* ── Header ───────────────────────────────────────── */

      .header {
        padding: 16px 18px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .title-icon {
        font-size: 16px;
        opacity: 0.7;
      }

      .title {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #f0f0f4;
      }

      .hint {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.35);
        padding-left: 24px;
      }

      /* ── Search ───────────────────────────────────────── */

      .search-row {
        padding: 10px 18px 4px;
      }

      .search-input {
        width: 100%;
        padding: 7px 10px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        color: #f0f0f4;
        font-family: inherit;
        font-size: 12.5px;
        line-height: 1.4;
        outline: none;
        transition: border-color 0.15s ease, background-color 0.15s ease;
      }
      .search-input::placeholder {
        color: rgba(255, 255, 255, 0.35);
      }
      .search-input:focus {
        border-color: rgba(59, 130, 246, 0.7);
        background: rgba(255, 255, 255, 0.09);
      }

      /* ── Sections ─────────────────────────────────────── */

      .section {
        padding: 10px 0 6px;
      }

      .section-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.35);
        padding: 0 18px 6px;
      }

      .section-note {
        font-size: 11.5px;
        color: rgba(255, 220, 100, 0.9);
        padding: 0 18px 8px;
        font-style: italic;
        line-height: 1.4;
      }

      /* ── Shortcut Rows ────────────────────────────────── */

      .shortcut-list {
        display: flex;
        flex-direction: column;
      }

      .shortcut-row {
        display: grid;
        grid-template-columns: 135px 1fr;
        align-items: center;
        padding: 5px 18px;
        gap: 12px;
        cursor: default;
        user-select: none;
        transition: background-color 0.15s ease;
      }

      .shortcut-row:hover {
        background-color: rgba(255, 255, 255, 0.05);
      }

      /* Keyboard focus must be visible: rows, the View more button and
         the search box all get a clear outline when focused by keyboard. */
      .shortcut-row:focus-visible,
      .toggle-more-btn:focus-visible,
      .search-input:focus-visible,
      .lock-icon:focus-visible {
        outline: 2px solid #6ea8ff;
        outline-offset: 1px;
      }
      .shortcut-row:focus-visible {
        background-color: rgba(255, 255, 255, 0.08);
      }

      .key-combo {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 3px 2px;
        min-width: 0;
      }

      .key-group {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }

      .label {
        color: rgba(255, 255, 255, 0.8);
        font-size: 12.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .key-sep {
        color: rgba(255, 255, 255, 0.35);
        font-size: 10px;
        font-weight: 500;
        margin: 0 1px;
        user-select: none;
      }

      .key-sep-or {
        color: rgba(255, 255, 255, 0.3);
        font-size: 9.5px;
        font-style: italic;
        font-family: inherit;
        margin: 0 3px;
        user-select: none;
      }

      .key-sep-then {
        color: rgba(255, 255, 255, 0.45);
        font-size: 11px;
        margin: 0 3px;
        user-select: none;
      }

      kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 4px;
        font-family: "SF Mono", "Cascadia Code", "Fira Code", "Consolas",
                     monospace;
        font-size: 11px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
        box-shadow:
          0 1px 0 rgba(0, 0, 0, 0.35),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 0.5px 0 rgba(255, 255, 255, 0.1);
        white-space: nowrap;
        line-height: 1;
      }

      .panel.locked {
        border-color: rgba(255, 255, 255, 0.25);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.6),
          0 0 0 1px rgba(255, 255, 255, 0.1),
          inset 0 0.5px 0 rgba(255, 255, 255, 0.2);
      }

      .lock-icon {
        margin-left: auto;
        font-size: 14px;
        opacity: 0.5;
        cursor: pointer;
        pointer-events: auto; /* clickable even though rows aren't */
      }
      .lock-icon:hover {
        opacity: 1;
      }
      .panel.locked .lock-icon {
        opacity: 0.9;
      }
      .panel.locked .hint {
        visibility: hidden; /* Hide the trigger hint when locked */
      }

      /* ── Collapsible Extra Shortcuts ──────────────────── */

      .extra-shortcuts {
        max-height: 200px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
      }
      .extra-shortcuts::-webkit-scrollbar {
        width: 5px;
      }
      .extra-shortcuts::-webkit-scrollbar-track {
        background: transparent;
      }
      .extra-shortcuts::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 4px;
      }

      .toggle-more-btn {
        display: block;
        width: 100%;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.45);
        font-family: inherit;
        font-size: 11.5px;
        font-weight: 500;
        padding: 5px 18px 8px;
        cursor: pointer;
        text-align: left;
        transition: color 0.15s ease;
        user-select: none;
      }
      .toggle-more-btn:hover {
        color: rgba(255, 255, 255, 0.85);
      }

      .empty-state {
        padding: 24px 18px;
        text-align: center;
        color: rgba(255, 255, 255, 0.5);
        font-size: 12.5px;
        font-style: italic;
        line-height: 1.5;
        user-select: none;
      }

      /* ── Light Mode Styles (used by prefers-color-scheme when not forced dark) ── */
      @media (prefers-color-scheme: light) {
        .panel:not([data-theme="dark"]) {
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(0, 0, 0, 0.1);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.12),
            0 2px 8px rgba(0, 0, 0, 0.08);
          color: #1a1a1e;
        }
        .panel.locked:not([data-theme="dark"]) {
          border-color: rgba(0, 0, 0, 0.25);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.15),
            0 0 0 1px rgba(0, 0, 0, 0.1),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
        }
        .panel:not([data-theme="dark"])::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
        }
        .panel:not([data-theme="dark"]) .extra-shortcuts {
          scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
        }
        .panel:not([data-theme="dark"]) .extra-shortcuts::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
        }
        .panel:not([data-theme="dark"]) .toggle-more-btn {
          color: rgba(0, 0, 0, 0.45);
        }
        .panel:not([data-theme="dark"]) .toggle-more-btn:hover {
          color: rgba(0, 0, 0, 0.85);
        }
        .panel:not([data-theme="dark"]) .empty-state {
          color: rgba(0, 0, 0, 0.5);
        }
        .panel:not([data-theme="dark"]) .shortcut-row:hover {
          background-color: rgba(0, 0, 0, 0.04);
        }
        .panel:not([data-theme="dark"]) .header {
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .panel:not([data-theme="dark"]) .title {
          color: #1a1a1e;
        }
        .panel:not([data-theme="dark"]) .hint,
        .panel:not([data-theme="dark"]) .section-label,
        .panel:not([data-theme="dark"]) .key-sep {
          color: rgba(0, 0, 0, 0.4);
        }
        .panel:not([data-theme="dark"]) .key-sep-or {
          color: rgba(0, 0, 0, 0.35);
        }
        .panel:not([data-theme="dark"]) .key-sep-then {
          color: rgba(0, 0, 0, 0.45);
        }
        .panel:not([data-theme="dark"]) .section-note {
          color: #d97706; /* slightly darker, readable orange/gold for light mode */
        }
        .panel:not([data-theme="dark"]) .label {
          color: rgba(0, 0, 0, 0.85);
        }
        .panel:not([data-theme="dark"]) .search-input {
          background: rgba(0, 0, 0, 0.04);
          border: 1px solid rgba(0, 0, 0, 0.12);
          color: #1a1a1e;
        }
        .panel:not([data-theme="dark"]) .search-input::placeholder {
          color: rgba(0, 0, 0, 0.4);
        }
        .panel:not([data-theme="dark"]) .search-input:focus {
          border-color: rgba(59, 130, 246, 0.7);
          background: rgba(0, 0, 0, 0.03);
        }
        .panel:not([data-theme="dark"]) kbd {
          background: rgba(0, 0, 0, 0.05);
          border: 1px solid rgba(0, 0, 0, 0.12);
          color: #1a1a1e;
          box-shadow:
            0 1px 0 rgba(0, 0, 0, 0.12),
            0 0 0 1px rgba(0, 0, 0, 0.04),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.8);
        }
      }

      /* ── Explicit Light Theme Override ────────────────── */
      .panel[data-theme="light"] {
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.12),
          0 2px 8px rgba(0, 0, 0, 0.08);
        color: #1a1a1e;
      }
      .panel.locked[data-theme="light"] {
        border-color: rgba(0, 0, 0, 0.25);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.15),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
      }
      .panel[data-theme="light"]::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.15);
      }
      .panel[data-theme="light"] .extra-shortcuts {
        scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
      }
      .panel[data-theme="light"] .extra-shortcuts::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.15);
      }
      .panel[data-theme="light"] .toggle-more-btn {
        color: rgba(0, 0, 0, 0.45);
      }
      .panel[data-theme="light"] .toggle-more-btn:hover {
        color: rgba(0, 0, 0, 0.85);
      }
      .panel[data-theme="light"] .empty-state {
        color: rgba(0, 0, 0, 0.5);
      }
      .panel[data-theme="light"] .shortcut-row:hover {
        background-color: rgba(0, 0, 0, 0.04);
      }
      .panel[data-theme="light"] .header {
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      }
      .panel[data-theme="light"] .title {
        color: #1a1a1e;
      }
      .panel[data-theme="light"] .hint,
      .panel[data-theme="light"] .section-label,
      .panel[data-theme="light"] .key-sep {
        color: rgba(0, 0, 0, 0.4);
      }
      .panel[data-theme="light"] .key-sep-or {
        color: rgba(0, 0, 0, 0.35);
      }
      .panel[data-theme="light"] .key-sep-then {
        color: rgba(0, 0, 0, 0.45);
      }
      .panel[data-theme="light"] .section-note {
        color: #d97706;
      }
      .panel[data-theme="light"] .label {
        color: rgba(0, 0, 0, 0.85);
      }
      .panel[data-theme="light"] .search-input {
        background: rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(0, 0, 0, 0.12);
        color: #1a1a1e;
      }
      .panel[data-theme="light"] .search-input::placeholder {
        color: rgba(0, 0, 0, 0.4);
      }
      .panel[data-theme="light"] .search-input:focus {
        border-color: rgba(59, 130, 246, 0.7);
        background: rgba(0, 0, 0, 0.03);
      }
      .panel[data-theme="light"] kbd {
        background: rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(0, 0, 0, 0.12);
        color: #1a1a1e;
        box-shadow:
          0 1px 0 rgba(0, 0, 0, 0.12),
          0 0 0 1px rgba(0, 0, 0, 0.04),
          inset 0 0.5px 0 rgba(255, 255, 255, 0.8);
      }
    `;
  }

  // ── DOM Auto-Detection (Phase 2) ───────────────────────────────────────────
  //
  // Scans the host page for elements with [accesskey] or [aria-keyshortcuts]
  // attributes. These are standard HTML/ARIA attributes that declare keyboard
  // shortcuts, but are usually invisible to users.
  //
  // This scan runs ONCE each time the overlay opens (not continuously), so
  // it has negligible performance impact.
  //

  /**
   * Clean up a raw label string:
   *   - Strip trailing "[alt-X]" / "[alt+x]" / "(alt-x)" bracket hints
   *     (Wikipedia and other sites include these in title attributes)
   *   - Collapse whitespace and trim
   *   - Cap length to avoid absurdly long labels
   * @param {string} raw
   * @returns {string}
   */
  function cleanLabel(raw) {
    let s = raw
      // Remove patterns like [alt-z], [alt+x], (alt-z), [Alt+Shift+E], etc.
      .replace(/\s*[\[(]alt[\s+\-].*?[\])]/gi, "")
      // Collapse multiple spaces
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return "";
    // Cap at 50 chars for readability
    return s.length > 50 ? s.slice(0, 50) + "…" : s;
  }

  /**
   * Extract a human-readable label from an element, using a fallback chain:
   *   aria-label → title → alt → placeholder → trimmed innerText → tag name
   * Each source is cleaned of redundant shortcut-key bracket hints.
   * @param {Element} el
   * @returns {string}
   */
  function getLabelForElement(el) {
    // Try aria-label first (most explicit accessibility label)
    const ariaLabel = cleanLabel(el.getAttribute("aria-label") || "");
    if (ariaLabel) return ariaLabel;

    // Try title attribute (common on links and buttons)
    const title = cleanLabel(el.getAttribute("title") || "");
    if (title) return title;

    // Try alt attribute (images, image buttons)
    const alt = cleanLabel(el.getAttribute("alt") || "");
    if (alt) return alt;

    // Try placeholder (input fields)
    const placeholder = cleanLabel(el.getAttribute("placeholder") || "");
    if (placeholder) return placeholder;

    // Try visible text content
    const text = cleanLabel(el.innerText || el.textContent || "");
    if (text) return text;

    return ""; // Reject generic fallbacks
  }

  /**
   * Format an accesskey value into the platform-appropriate shortcut string.
   * On Windows/Linux Chrome, accesskey triggers with Alt + <key>.
   * @param {string} key  The raw accesskey attribute value (single character)
   * @returns {string}
   */
  function formatAccessKey(key) {
    return `Alt + ${key.toUpperCase()}`;
  }

  /**
   * Scan the current page DOM for [accesskey] and [aria-keyshortcuts] elements.
   * Returns a deduplicated array of {keys, label} objects.
   * @returns {{keys: string, label: string}[]}
   */
  /**
   * Scan the current page DOM for [accesskey] and [aria-keyshortcuts] elements.
   * Returns a deduplicated array of {keys, label} objects.
   * v0.1.11: also scans same-origin iframes and shadow roots, not just the
   * top document — sites with no DB entry can hide their shortcuts in an
   * embedded frame or a web component. Cross-origin and sandboxed iframes
   * cannot be scanned from the top frame (the browser blocks access to
   * their documents); that is a documented limit, not something this
   * function can work around.
   * @returns {{keys: string, label: string}[]}
   */
  function scanPageShortcuts() {
    const keyGroups = {}; // key -> array of labels

    function addShortcut(keys, label) {
      if (!label || label.trim().length === 0) return;
      // Filter out overly generic labels
      if (/^(button|span|div|a element|svg|path|img|link|input)$/i.test(label)) return;

      if (!keyGroups[keys]) keyGroups[keys] = [];
      keyGroups[keys].push(label);
    }

    // Scan one document-like root (the top document, an iframe document,
    // or a shadow root) for [accesskey] and [aria-keyshortcuts] elements.
    function scanRoot(root) {
      // ── [accesskey] elements ─────────────────────────────────────────────
      try {
        const accessKeyEls = root.querySelectorAll("[accesskey]");
        for (const el of accessKeyEls) {
          const rawKey = el.getAttribute("accesskey");
          if (!rawKey) continue;
          const keys = formatAccessKey(rawKey);
          addShortcut(keys, getLabelForElement(el));
        }
      } catch (_) {}

      // ── [aria-keyshortcuts] elements ─────────────────────────────────────
      try {
        const ariaEls = root.querySelectorAll("[aria-keyshortcuts]");
        for (const el of ariaEls) {
          const rawKeys = el.getAttribute("aria-keyshortcuts");
          if (!rawKeys) continue;
          const keys = rawKeys
            .replace(/Control/g, "Ctrl")
            .replace(/\+/g, " + ");
          addShortcut(keys, getLabelForElement(el));
        }
      } catch (_) {}
    }

    // Collect every scannable root: the top document, plus any same-origin
    // iframe documents and any shadow roots reachable from them.
    const roots = [document];
    const seenRoots = new Set(roots);
    function collectRoots(root) {
      let elements = [];
      try { elements = root.querySelectorAll("*") || []; } catch (_) { elements = []; }
      for (const el of elements) {
        // Never scan our own overlay host: its shadow DOM is ours, not the
        // page's, and its rows must never show up as "page shortcuts".
        if (el === hostEl) continue;
        // Shadow DOM: a shadow root is a separate document-like tree whose
        // elements the top document's querySelectorAll never sees.
        if (el.shadowRoot && !seenRoots.has(el.shadowRoot)) {
          seenRoots.add(el.shadowRoot);
          roots.push(el.shadowRoot);
          collectRoots(el.shadowRoot);
        }
        // Same-origin iframe: reading contentDocument throws for
        // cross-origin or sandboxed frames — those are skipped (limit).
        if (el.tagName === "IFRAME") {
          try {
            const doc = el.contentDocument;
            if (doc && !seenRoots.has(doc)) {
              seenRoots.add(doc);
              roots.push(doc);
              collectRoots(doc);
            }
          } catch (_) { /* cross-origin / sandboxed: cannot scan */ }
        }
      }
    }
    collectRoots(document);
    for (const root of roots) scanRoot(root);

    const finalList = [];
    for (const keys in keyGroups) {
      const labels = Array.from(new Set(keyGroups[keys])); // deduplicate exact labels
      if (labels.length >= 3) {
        finalList.push({ keys, label: `Multiple actions (${labels.length})` });
      } else {
        labels.forEach(label => finalList.push({ keys, label }));
      }
    }

    // Cap at 6 entries
    return finalList.slice(0, 6);
  }

  /**
   * Update the "This Page" section in the overlay.
   * If shortcuts were detected, create/replace the section.
   * If none were found, remove the section if it exists.
   */
  function updatePageSection() {
    const siteKey = resolveSiteKey();

    // Look up in DB by resolved site key (e.g. sheets.google.com for a
    // spreadsheet, even though its hostname is docs.google.com).
    const dbEntry = shortcutsDb[siteKey];
    let pageShortcuts = [];
    let dbNote = null;
    
    if (dbEntry) {
      // 1. Curated takes priority — but v0.1.11 no longer lets a thin curated
      // entry suppress DOM detection entirely. If it has fewer than 10
      // shortcuts, supplement it with auto-detected page shortcuts
      // (deduped by keys) so the overlay is still useful on sites whose
      // curated list is a stub. Copy the array first: pushing into it
      // would mutate the loaded DB in memory.
      if (Array.isArray(dbEntry)) {
        pageShortcuts = dbEntry.slice();
      } else if (typeof dbEntry === "object") {
        pageShortcuts = (dbEntry.shortcuts || []).slice();
        dbNote = dbEntry.note || null;
      }
      if (pageShortcuts.length < 10) {
        const seen = new Set(pageShortcuts.map((s) => s.keys.replace(/\s+/g, '').toLowerCase()));
        for (const sc of scanPageShortcuts()) {
          if (pageShortcuts.length >= 10) break;
          const norm = sc.keys.replace(/\s+/g, '').toLowerCase();
          if (!seen.has(norm)) { seen.add(norm); pageShortcuts.push(sc); }
        }
      }
    } else {
      // 2. No curated entry, run DOM scan
      pageShortcuts = scanPageShortcuts();
    }

    // Remove the old page section if it exists
    if (pageSectionEl) {
      pageSectionEl.remove();
      pageSectionEl = null;
    }

    // Always rebuild Chrome section as well so its collapsed state resets on each open
    if (chromeSectionEl) {
      chromeSectionEl.remove();
      chromeSectionEl = null;
    }

    // Remove old empty state message if it exists
    if (emptyStateEl) {
      emptyStateEl.remove();
      emptyStateEl = null;
    }

    // Only add the section if we found shortcuts on this page
    if (pageShortcuts.length > 0) {
      // Use the site's domain as the section title instead of generic "This Page"
      pageSectionEl = buildSection(siteKey.toUpperCase(), pageShortcuts, dbNote);
      panelEl.appendChild(pageSectionEl);
    }

    // Tier 1: Global Chrome Shortcuts (only if enabled in settings)
    if (showGlobalShortcuts) {
      chromeSectionEl = buildSection("Chrome", GLOBAL_SHORTCUTS);
      panelEl.appendChild(chromeSectionEl);
    }

    // If both Tier 1 and Tier 2 have nothing to show, display a friendly empty state
    if (!pageSectionEl && !chromeSectionEl) {
      emptyStateEl = document.createElement("div");
      emptyStateEl.classList.add("empty-state");
      emptyStateEl.textContent = "No site-specific shortcuts found for this page.";
      panelEl.appendChild(emptyStateEl);
    }
  }

  // ── Panel Positioning ──────────────────────────────────────────────────────

  /**
   * Clamp x,y so the panel stays fully within the viewport.
   * @param {number} x - left position
   * @param {number} y - top position
   * @param {number} w - panel width
   * @param {number} h - panel height
   * @returns {{x: number, y: number}}
   */
  function clampPosition(x, y, w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    return {
      x: Math.max(margin, Math.min(x, vw - w - margin)),
      y: Math.max(margin, Math.min(y, vh - h - margin))
    };
  }

  /**
   * Compute the default position from the overlayPosition preset.
   * @param {number} w - panel width
   * @param {number} h - panel height
   * @returns {{x: number, y: number}}
   */
  function getPresetPosition(w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 24;
    switch (overlayPosition) {
      case "bottom-left":  return { x: pad,                    y: vh - h - pad };
      case "top-right":    return { x: vw - w - pad,           y: pad };
      case "top-left":     return { x: pad,                    y: pad };
      case "center":       return { x: (vw - w) / 2,          y: (vh - h) / 2 };
      case "bottom-right":
      default:             return { x: vw - w - pad,           y: vh - h - pad };
    }
  }

  /**
   * Apply the current position from the overlayPosition preset to the panel element.
   * Must be called after the panel has rendered content (needs real dimensions).
   */
  function applyPanelPosition() {
    if (!panelEl) return;

    const rect = panelEl.getBoundingClientRect();
    const w = rect.width || 380;
    const h = rect.height || 300;

    const pos = clampPosition(getPresetPosition(w, h).x, getPresetPosition(w, h).y, w, h);

    panelEl.style.left = pos.x + "px";
    panelEl.style.top = pos.y + "px";
    // Clear any bottom/right that might be set
    panelEl.style.right = "auto";
    panelEl.style.bottom = "auto";
  }

  // ── Show / Hide & State Transitions ────────────────────────────────────────

  // ── Search / Filter (Phase 6) ────────────────────────────────────────────
  /**
   * Live-filter every shortcut row by label or keys (case-insensitive
   * substring). Rows hidden behind a section's "View more" toggle are
   * included in the search — when filtering, extra rows are shown and the
   * toggle is hidden; when the query is cleared, each section returns to
   * its previous collapsed/expanded state. Empty sections are hidden, and
   * a "no match" message is shown when nothing matches anywhere.
   * @param {string} rawQuery
   */
  function applySearchFilter(rawQuery) {
    if (!panelEl) return;
    const q = (rawQuery || "").trim().toLowerCase();

    // Remove any previous no-match message
    if (searchEmptyEl) {
      searchEmptyEl.remove();
      searchEmptyEl = null;
    }

    let totalVisible = 0;
    const sections = panelEl.querySelectorAll(".section");
    sections.forEach((section) => {
      let visibleInSection = 0;
      const rows = section.querySelectorAll(".shortcut-row");
      rows.forEach((row) => {
        const match = !q || row.textContent.toLowerCase().includes(q);
        row.style.display = match ? "" : "none";
        if (match) visibleInSection++;
      });

      const extra = section.querySelector(".extra-shortcuts");
      const toggle = section.querySelector(".toggle-more-btn");
      if (extra) {
        if (q) {
          // Filtering: show every matching row, even the collapsed ones.
          extra.style.display = "block";
        } else {
          // Restoring: back to whatever the toggle said before filtering.
          extra.style.display = (toggle && toggle.classList.contains("expanded")) ? "block" : "none";
        }
      }
      if (toggle) {
        // The toggle is meaningless while filtering (all matches are shown).
        toggle.style.display = q ? "none" : "";
      }

      section.style.display = visibleInSection > 0 ? "" : "none";
      totalVisible += visibleInSection;
    });

    if (q && totalVisible === 0) {
      searchEmptyEl = document.createElement("div");
      searchEmptyEl.classList.add("empty-state");
      searchEmptyEl.textContent = `No shortcuts match "${(rawQuery || "").trim()}".`;
      panelEl.appendChild(searchEmptyEl);
    }
  }

  function clearSearch() {
    if (searchInputEl) searchInputEl.value = "";
    applySearchFilter("");
  }

  // Rows that are actually visible: their own display is not none, and no
  // ancestor (section, extra container) is hidden either. Used by arrow-key
  // navigation and by the search filter's visible-row count.
  function getVisibleRows() {
    if (!panelEl) return [];
    return Array.from(panelEl.querySelectorAll(".shortcut-row")).filter((row) => {
      let node = row;
      while (node && node !== panelEl) {
        if (node.style && node.style.display === "none") return false;
        node = node.parentNode || node.parent; // parentNode in browsers, parent in tests
      }
      return row.style.display !== "none";
    });
  }

  function setOverlayState(newState) {
    if (overlayState === newState) return;

    // Leaving hidden state -> prepare UI
    if (overlayState === 'hidden') {
      if (!panelEl) createOverlay();
      applyTheme();
      updatePageSection();
      // A fresh open always starts unfiltered, even if the last session
      // was closed mid-search.
      clearSearch();
      panelEl.offsetHeight; // force reflow
      applyPanelPosition();
    }
    
    overlayState = newState;
    
    if (!panelEl) return;
    const lockIcon = shadowRoot.querySelector('.lock-icon');

    // Entering state
    if (overlayState === 'hidden') {
      panelEl.classList.remove('visible', 'locked');
      if (lockIcon) { lockIcon.textContent = "🔓"; lockIcon.setAttribute("aria-pressed", "false"); }
      // Do not carry a stale query into the next open.
      clearSearch();
    } else if (overlayState === 'visible') {
      panelEl.classList.add('visible');
      panelEl.classList.remove('locked');
      if (lockIcon) { lockIcon.textContent = "🔓"; lockIcon.setAttribute("aria-pressed", "false"); }
    } else if (overlayState === 'locked') {
      panelEl.classList.add('visible', 'locked');
      if (lockIcon) { lockIcon.textContent = "🔒"; lockIcon.setAttribute("aria-pressed", "true"); }
      // Keyboard users land in the search box when the overlay locks, so
      // they can type to filter or press Down to walk the shortcut rows.
      if (searchInputEl) {
        try { searchInputEl.focus(); } catch (_) {}
      }
    }
  }

  // ── Long-Press Detection & Lock Controls ───────────────────────────────────

  function clearTimer() {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  /**
   * Check if a keyboard event matches the currently configured lock combo.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  function isLockCombo(e) {
    if (!e.ctrlKey) return false;
    switch (lockCombo) {
      case "ctrlSpace":     return e.code === "Space";
      case "ctrlSlash":     return e.key === "/" || e.code === "Slash";
      case "ctrlSemicolon": return e.key === ";" || e.code === "Semicolon";
      default:              return false;
    }
  }

  function onKeyDown(e) {
    // 1. GATE: only intercept Esc and lock-combo if overlay is active
    if (overlayState !== 'hidden') {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        // First Esc while typing in the search box only clears the query
        // (and stays open); a second Esc — or Esc anywhere else — closes.
        const searchFocused = searchInputEl && shadowRoot && shadowRoot.activeElement === searchInputEl;
        if (searchFocused && searchInputEl.value) {
          clearSearch();
          return;
        }
        setOverlayState('hidden');
        return;
      }

      // "/" focuses the search box when locked (and not already typing in
      // it). Gated to locked-only, so it never hijacks "/" on the page.
      if (overlayState === 'locked' && e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const searchFocused = searchInputEl && shadowRoot && shadowRoot.activeElement === searchInputEl;
        if (searchInputEl && !searchFocused) {
          e.preventDefault();
          e.stopImmediatePropagation();
          searchInputEl.focus();
          return;
        }
      }

      if (isLockCombo(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (overlayState === 'visible') {
          setOverlayState('locked');
        } else if (overlayState === 'locked') {
          setOverlayState('hidden');
        }
        return; // Don't trigger the long-press logic below
      }
    }

    // 2. Long-press detection for the configured trigger key. What the
    // timer does when it fires depends on the trigger mode: in "peek"
    // mode the overlay appears while the key is held; in "release" mode
    // (default) it only arms the release trigger and nothing appears
    // while the key is held, so a user who goes on to click, scroll or
    // press another key never sees the overlay at all.
    if (e.key === triggerKey && !e.repeat && pressTimer === null && overlayState === 'hidden' && !longPressSuppressed) {
      // Skip if other modifiers are held (except the trigger key itself)
      if (triggerKey === "Control" && (e.altKey || e.shiftKey || e.metaKey)) return;
      if (triggerKey === "Alt" && (e.ctrlKey || e.shiftKey || e.metaKey)) return;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (triggerMode === "peek") {
          setOverlayState('visible');
        } else {
          longPressReady = true;
        }
      }, longPressDuration);
    }

    // Any other key during the hold disqualifies the release trigger:
    // Ctrl+C, Ctrl+V, Ctrl+Tab and friends must never open the overlay
    // when the user lets go afterwards.
    if (e.key !== triggerKey) {
      if (pressTimer !== null) clearTimer();
      longPressReady = false;
    }
  }

  function onKeyUp(e) {
    if (e.key === triggerKey) {
      clearTimer();
      if (triggerMode === "peek") {
        // Peek mode: releasing the key hides the transient overlay.
        // (Ctrl+Space locks it first, and a locked overlay ignores
        // the release.) The release trigger flag is unused here.
        longPressReady = false;
        longPressSuppressed = false;
        if (overlayState === 'visible') {
          setOverlayState('hidden');
        }
        return;
      }
      // Release mode (v0.1.11): a clean hold of longPressDuration with
      // no other input opens the overlay on release, locked open (Esc,
      // click-outside or Ctrl+Space closes it). A short tap, or a hold
      // that included a click, scroll or another key, opens nothing.
      // NOTE: read longPressSuppressed BEFORE clearing it below.
      const shouldOpen = longPressReady && !longPressSuppressed && overlayState === 'hidden';
      longPressReady = false;
      // The hold is over: a later press may trigger the overlay again.
      longPressSuppressed = false;
      if (shouldOpen) {
        setOverlayState('locked');
        return;
      }
      // Only release-to-hide if we are in transient 'visible' state
      // (reachable via the lock-icon toggle). If we are 'locked',
      // releasing the trigger key does nothing.
      if (overlayState === 'visible') {
        setOverlayState('hidden');
      }
    }
  }

  function onBlur() {
    clearTimer();
    longPressReady = false;
    longPressSuppressed = false;
    // Only force-hide on blur if NOT locked
    if (overlayState === 'visible') {
      setOverlayState('hidden');
    }
  }
  
  // v0.1.11 (release trigger): a bare Ctrl hold is also how users
  // Ctrl+click to multi-select or Ctrl+scroll to zoom (Figma, Miro,
  // Canva, Drive, Photos, Maps). A mouse click or a scroll-wheel turn
  // during the hold means the user is doing something else, so it
  // disqualifies the release trigger entirely: the timer is cancelled,
  // the armed flag is cleared, and the hold stays suppressed until the
  // key is released. The overlay therefore never appears for a
  // Ctrl+click / Ctrl+scroll, however long the key stays held. A locked
  // overlay is untouched — locking is deliberate, and onDocumentClick
  // already handles closing it. (The transient-'visible' hide below only
  // covers the lock-icon toggle path; the trigger itself never opens the
  // overlay mid-hold anymore.)
  function onPointerInput(e) {
    clearTimer();
    longPressReady = false;
    const triggerHeld = e
      ? (triggerKey === "Control" ? !!e.ctrlKey : triggerKey === "Alt" ? !!e.altKey : false)
      : false;
    if (!triggerHeld) return;
    longPressSuppressed = true;
    if (overlayState === 'visible') {
      setOverlayState('hidden');
    }
  }

  function onDocumentClick(e) {
    if (overlayState === 'locked') {
      // Use composedPath to see if the click originated inside our Shadow DOM
      const path = e.composedPath();
      if (hostEl && !path.includes(hostEl)) {
        setOverlayState('hidden');
      }
    }
  }

  // ── Same-origin iframes (v0.1.9.2) ───────────────────────────────────────
  // Google Docs/Slides catch keys in a hidden about:blank iframe, so the
  // top document never sees the Ctrl hold. The top frame hooks every
  // same-origin iframe's window directly instead of relying on code
  // running inside the frame. Listeners go on the iframe's *window* (not
  // its document), so they survive Docs rewriting the iframe's document
  // with document.write, and a MutationObserver catches iframes added
  // later (Slides adds its editor iframe dynamically; Docs has it at
  // load). Cross-origin iframes throw on contentWindow access and are
  // skipped — the top frame cannot listen inside them.
  const hookedIframeWindows = new Set();
  const observedIframeDocs = new Set();
  const observedIframeEls = new Set();
  const iframeObservers = [];

  function onIframeClick() {
    // A click inside another document is always "outside" our overlay.
    if (overlayState === 'locked') setOverlayState('hidden');
  }

  function observeIframeDocument(doc) {
    if (!doc || observedIframeDocs.has(doc)) return;
    observedIframeDocs.add(doc);
    let frames = [];
    try { frames = doc.querySelectorAll('iframe') || []; } catch (err) { frames = []; }
    frames.forEach(hookIframe);
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations || []) {
          for (const node of m.addedNodes || []) {
            if (!node) continue;
            if (node.tagName === 'IFRAME') hookIframe(node);
            if (typeof node.querySelectorAll === 'function') {
              let nested = [];
              try { nested = node.querySelectorAll('iframe') || []; } catch (err) { nested = []; }
              nested.forEach(hookIframe);
            }
          }
        }
      });
      try {
        observer.observe(doc, { childList: true, subtree: true });
        iframeObservers.push(observer);
      } catch (err) { /* some documents cannot be observed; ignore */ }
    }
  }

  function hookIframe(el) {
    let win = null;
    try { win = el.contentWindow; } catch (err) { return; } // cross-origin
    if (!win || hookedIframeWindows.has(win)) return;
    hookedIframeWindows.add(win);
    try {
      win.addEventListener('keydown', onKeyDown, true);
      win.addEventListener('keyup', onKeyUp, true);
      win.addEventListener('click', onIframeClick, true);
      // v0.1.11: a click/scroll inside the iframe is also user input, so it
      // cancels the pending long-press just like input in the top document.
      win.addEventListener('mousedown', onPointerInput, true);
      win.addEventListener('wheel', onPointerInput, true);
    } catch (err) { return; }
    if (!observedIframeEls.has(el)) {
      observedIframeEls.add(el);
      // A navigated iframe gets a new window object; re-hook on load.
      try { el.addEventListener('load', () => hookIframe(el)); } catch (err) { /* ignore */ }
    }
    // Nested iframes inside this one (an editor frame inside a frame).
    try { observeIframeDocument(win.document); } catch (err) { /* cross-origin */ }
  }

  function startIframeWatching() {
    observeIframeDocument(document);
  }

  function stopIframeWatching() {
    for (const win of hookedIframeWindows) {
      try {
        win.removeEventListener('keydown', onKeyDown, true);
        win.removeEventListener('keyup', onKeyUp, true);
        win.removeEventListener('click', onIframeClick, true);
        win.removeEventListener('mousedown', onPointerInput, true);
        win.removeEventListener('wheel', onPointerInput, true);
      } catch (err) { /* ignore */ }
    }
    hookedIframeWindows.clear();
    for (const obs of iframeObservers) {
      try { obs.disconnect(); } catch (err) { /* ignore */ }
    }
    iframeObservers.length = 0;
    observedIframeDocs.clear();
    observedIframeEls.clear();
  }

  // ── Attach / Detach Listeners ──────────────────────────────────────────────

  function attachListeners() {
    if (listenersAttached) return;
    if (isInertFrame) {
      // Same-origin iframe: the top frame hooks our window directly, so
      // we attach nothing here and build no overlay of our own.
      listenersAttached = true;
      return;
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("click", onDocumentClick, true);
    // v0.1.11: cancel a pending long-press on mouse/scroll input (see
    // onPointerInput) — Ctrl+click multi-select and Ctrl+scroll zoom must
    // not pop the overlay up mid-gesture.
    document.addEventListener("mousedown", onPointerInput, true);
    document.addEventListener("wheel", onPointerInput, true);
    startIframeWatching();
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    if (!isInertFrame) {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("mousedown", onPointerInput, true);
      document.removeEventListener("wheel", onPointerInput, true);
      stopIframeWatching();
    }
    listenersAttached = false;
    // Clean up any active state
    clearTimer();
    longPressReady = false;
    longPressSuppressed = false;
    if (overlayState !== 'hidden') {
      setOverlayState('hidden');
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  /**
   * Apply the theme setting to the overlay panel.
   */
  function applyTheme() {
    if (!panelEl) return;
    if (theme === "light" || theme === "dark") {
      panelEl.setAttribute("data-theme", theme);
    } else {
      panelEl.removeAttribute("data-theme");
    }
  }

  /**
   * Apply a settings object to the running variables.
   * @param {object} settings — merged with SETTINGS_DEFAULTS before calling
   */
  function applySettings(settings) {
    longPressDuration = settings.longPressDuration;
    triggerKey = settings.triggerKey;
    triggerMode = settings.triggerMode === "peek" ? "peek" : "release";
    lockCombo = settings.lockCombo;
    overlayPosition = settings.overlayPosition || "bottom-right";
    theme = settings.theme || "auto";
    showGlobalShortcuts = settings.showGlobalShortcuts !== undefined ? settings.showGlobalShortcuts : true;
    applyTheme();
    if (hintEl) {
      hintEl.textContent = triggerMode === "peek"
        ? "Hold Ctrl to peek"
        : "Hold Ctrl, then release to open";
    }
  }

  /**
   * Normalise a hostname for comparison / lookup: lowercase and strip a
   * single leading www. / en. / m. prefix.
   * This is the ONE canonical normaliser — popup.js and options.js use the
   * exact same rule, so a site disabled in one place is disabled everywhere.
   * (Previously content.js only stripped www., so disabling en.wikipedia.org
   * stored "wikipedia.org" but content.js still checked "en.wikipedia.org".)
   * @param {string} hostname
   * @returns {string}
   */
  function normalizeHost(hostname) {
    return (hostname || "").toLowerCase().replace(/^(www|en|m)\./, "");
  }

  /**
   * Determine whether the extension should be active on the current page.
   * @param {object} settings
   * @returns {boolean}
   */
  function shouldBeActive(settings) {
    if (!settings.enabled) return false;
    // Normalise BOTH sides: stored entries may pre-date the fix (e.g. an
    // un-normalised "en.wikipedia.org") and must still match. Compared
    // against the resolved site key, so disabling "Sheets" disables
    // spreadsheets (docs.google.com/spreadsheets/…) and not Docs.
    const host = resolveSiteKey();
    const disabledSites = (settings.disabledSites || []).map(normalizeHost);
    return !disabledSites.includes(host);
  }

  // Load shortcuts DB via the background worker (v0.1.8). A direct fetch()
  // from here is blocked by strict page CSPs (e.g. accounts.google.com),
  // which used to log "Failed to load shortcuts-db" on the Errors page.
  // The worker's fetch is not subject to any page's CSP. If messaging is
  // unavailable (older test stubs), fall back to a direct fetch.
  function loadShortcutsDbDirect() {
    try {
      const dbUrl = chrome.runtime.getURL("shortcuts-db.json");
      fetch(dbUrl)
        .then(r => r.json())
        .then(data => {
          shortcutsDb = data;
          // v0.1.11: re-render if the overlay already exists, so a DB that
          // arrives after the user opened the overlay still shows its site
          // section instead of waiting for the next open.
          if (panelEl) updatePageSection();
        })
        .catch(() => {
          // DB unavailable (e.g. strict page CSP): the overlay still works
          // with the global shortcuts + auto-detected ones, so stay silent
          // instead of logging an error for every such page.
        });
    } catch (err) {
      // getURL might fail in some sandboxed environments, just ignore
    }
  }
  // A same-origin iframe is inert (the top frame hooks it), so it needs no DB.
  if (!isInertFrame) {
    try {
      if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        chrome.runtime.sendMessage({ type: "get-shortcuts-db" }, (data) => {
          if (data) {
            shortcutsDb = data;
            // v0.1.11: the DB may arrive after the user already opened the
            // overlay (or held Ctrl before it loaded) — re-render so the
            // site section appears instead of waiting for the next open.
            if (panelEl) updatePageSection();
          } else if (chrome.runtime.lastError) {
            loadShortcutsDbDirect();
          }
        });
      } else {
        loadShortcutsDbDirect();
      }
    } catch (err) {
      loadShortcutsDbDirect();
    }
  }

  // Read settings and conditionally initialize
  chrome.storage.sync.get(SETTINGS_DEFAULTS, (settings) => {
    applySettings(settings);
    if (shouldBeActive(settings)) {
      attachListeners();
    }
  });

  // Listen for live setting changes (from the options page or popup)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    // Build a fresh settings snapshot from current values + changes
    chrome.storage.sync.get(SETTINGS_DEFAULTS, (settings) => {
      applySettings(settings);

      const active = shouldBeActive(settings);
      if (active && !listenersAttached) {
        attachListeners();
      } else if (!active && listenersAttached) {
        detachListeners();
      }

      // If overlay is currently visible or locked, refresh its content and reposition
      if (panelEl && overlayState !== 'hidden') {
        updatePageSection();
        // updatePageSection rebuilds the sections, so re-apply any active search.
        if (searchInputEl) applySearchFilter(searchInputEl.value);
        // Force reflow so getBoundingClientRect reflects the updated section height
        panelEl.offsetHeight;
        applyPanelPosition();
      }
    });
  });
})();
