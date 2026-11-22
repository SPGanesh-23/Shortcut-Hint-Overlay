// =============================================================================
// Shortcut Hint Overlay — Content Script (Phase 1 + Phase 2)
// =============================================================================
// Injected into every normal web page. Detects a long-press of the Ctrl key
// (~500 ms hold) and shows a Shadow DOM overlay listing keyboard shortcuts.
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
    lockCombo: "ctrlSpace",
    disabledSites: [],
    overlayPosition: "bottom-right",
    theme: "auto",
    showGlobalShortcuts: true
  };

  let longPressDuration = SETTINGS_DEFAULTS.longPressDuration;
  let triggerKey = SETTINGS_DEFAULTS.triggerKey;
  let lockCombo = SETTINGS_DEFAULTS.lockCombo;
  let overlayPosition = SETTINGS_DEFAULTS.overlayPosition;
  let theme = SETTINGS_DEFAULTS.theme;
  let showGlobalShortcuts = SETTINGS_DEFAULTS.showGlobalShortcuts;

  const FADE_DURATION_MS = 150;    // Matches the CSS transition duration

  // ── State ──────────────────────────────────────────────────────────────────
  let pressTimer = null;           // setTimeout handle for the long-press
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
  let searchEmptyEl = null;        // "No shortcuts match …" element (or null)

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

    titleRow.appendChild(icon);
    titleRow.appendChild(title);
    titleRow.appendChild(lockIcon);

    const hint = document.createElement("span");
    hint.classList.add("hint");
    hint.textContent = "Hold Ctrl to keep open";

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
      // stop the keystroke reaching the page underneath.
      e.stopPropagation();
    });

    searchRow.appendChild(searchInputEl);
    panelEl.appendChild(searchRow);

    // Click to lock (if currently just visible)
    panelEl.addEventListener("click", () => {
      if (overlayState === 'visible') {
        setOverlayState('locked');
      }
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
    for (const sc of topShortcuts) {
      list.appendChild(createShortcutRow(sc));
    }
    section.appendChild(list);

    // If more than 3, add extra scrollable container & toggle button
    if (extraShortcuts.length > 0) {
      const extraContainer = document.createElement("div");
      extraContainer.classList.add("extra-shortcuts");
      extraContainer.style.display = "none"; // Collapsed by default

      const extraList = document.createElement("div");
      extraList.classList.add("shortcut-list", "extra-list");
      for (const sc of extraShortcuts) {
        extraList.appendChild(createShortcutRow(sc));
      }
      extraContainer.appendChild(extraList);
      section.appendChild(extraContainer);

      const toggleBtn = document.createElement("button");
      toggleBtn.classList.add("toggle-more-btn");
      toggleBtn.type = "button";
      toggleBtn.textContent = `View more (${extraShortcuts.length})`;

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCollapsed = extraContainer.style.display === "none";
        if (isCollapsed) {
          extraContainer.style.display = "block";
          toggleBtn.textContent = "Show less";
          toggleBtn.classList.add("expanded");
        } else {
          extraContainer.style.display = "none";
          toggleBtn.textContent = `View more (${extraShortcuts.length})`;
          toggleBtn.classList.remove("expanded");
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
        visibility: hidden; /* Hide the "Hold Ctrl" hint when locked */
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
  function scanPageShortcuts() {
    const keyGroups = {}; // key -> array of labels

    function addShortcut(keys, label) {
      if (!label || label.trim().length === 0) return;
      // Filter out overly generic labels
      if (/^(button|span|div|a element|svg|path|img|link|input)$/i.test(label)) return;
      
      if (!keyGroups[keys]) keyGroups[keys] = [];
      keyGroups[keys].push(label);
    }

    // ── [accesskey] elements ─────────────────────────────────────────────
    try {
      const accessKeyEls = document.querySelectorAll("[accesskey]");
      for (const el of accessKeyEls) {
        const rawKey = el.getAttribute("accesskey");
        if (!rawKey) continue;
        const keys = formatAccessKey(rawKey);
        addShortcut(keys, getLabelForElement(el));
      }
    } catch (_) {}

    // ── [aria-keyshortcuts] elements ─────────────────────────────────────
    try {
      const ariaEls = document.querySelectorAll("[aria-keyshortcuts]");
      for (const el of ariaEls) {
        const rawKeys = el.getAttribute("aria-keyshortcuts");
        if (!rawKeys) continue;
        const keys = rawKeys
          .replace(/Control/g, "Ctrl")
          .replace(/\+/g, " + ");
        addShortcut(keys, getLabelForElement(el));
      }
    } catch (_) {}

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
    const host = window.location.hostname;
    const cleanHost = normalizeHost(host);
    
    // Look up in DB by exact host, or cleaned host (e.g. en.wikipedia.org or wikipedia.org)
    const dbEntry = shortcutsDb[host] || shortcutsDb[cleanHost];
    let pageShortcuts = [];
    let dbNote = null;
    
    if (dbEntry) {
      // 1. Curated takes full priority. Do NOT run DOM scan.
      if (Array.isArray(dbEntry)) {
        pageShortcuts = dbEntry;
      } else if (typeof dbEntry === "object") {
        pageShortcuts = dbEntry.shortcuts || [];
        dbNote = dbEntry.note || null;
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
      pageSectionEl = buildSection(cleanHost.toUpperCase(), pageShortcuts, dbNote);
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
      if (lockIcon) lockIcon.textContent = "🔓";
      // Do not carry a stale query into the next open.
      clearSearch();
    } else if (overlayState === 'visible') {
      panelEl.classList.add('visible');
      panelEl.classList.remove('locked');
      if (lockIcon) lockIcon.textContent = "🔓";
    } else if (overlayState === 'locked') {
      panelEl.classList.add('visible', 'locked');
      if (lockIcon) lockIcon.textContent = "🔒";
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

    // 2. Long-press detection for the configured trigger key
    if (e.key === triggerKey && !e.repeat && pressTimer === null && overlayState === 'hidden') {
      // Skip if other modifiers are held (except the trigger key itself)
      if (triggerKey === "Control" && (e.altKey || e.shiftKey || e.metaKey)) return;
      if (triggerKey === "Alt" && (e.ctrlKey || e.shiftKey || e.metaKey)) return;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        setOverlayState('visible');
      }, longPressDuration);
    }

    if (e.key !== triggerKey && pressTimer !== null) {
      clearTimer();
    }
  }

  function onKeyUp(e) {
    if (e.key === triggerKey) {
      clearTimer();
      // Only release-to-hide if we are in transient 'visible' state.
      // If we are 'locked', releasing the trigger key does nothing.
      if (overlayState === 'visible') {
        setOverlayState('hidden');
      }
    }
  }

  function onBlur() {
    clearTimer();
    // Only force-hide on blur if NOT locked
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

  // ── Attach / Detach Listeners ──────────────────────────────────────────────

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("click", onDocumentClick, true);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("click", onDocumentClick, true);
    listenersAttached = false;
    // Clean up any active state
    clearTimer();
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
    lockCombo = settings.lockCombo;
    overlayPosition = settings.overlayPosition || "bottom-right";
    theme = settings.theme || "auto";
    showGlobalShortcuts = settings.showGlobalShortcuts !== undefined ? settings.showGlobalShortcuts : true;
    applyTheme();
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
    // un-normalised "en.wikipedia.org") and must still match.
    const host = normalizeHost(window.location.hostname);
    const disabledSites = (settings.disabledSites || []).map(normalizeHost);
    return !disabledSites.includes(host);
  }

  // Load shortcuts DB
  try {
    const dbUrl = chrome.runtime.getURL("shortcuts-db.json");
    fetch(dbUrl)
      .then(r => r.json())
      .then(data => { shortcutsDb = data; })
      .catch(err => console.error("Failed to load shortcuts-db", err));
  } catch (err) {
    // getURL might fail in some sandboxed environments, just ignore
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
