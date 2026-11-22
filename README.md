# Shortcut Hint Overlay — Chrome Extension

[![CI](https://github.com/SPGanesh-23/Shortcut-Hint-Overlay/actions/workflows/ci.yml/badge.svg)](https://github.com/SPGanesh-23/Shortcut-Hint-Overlay/actions/workflows/ci.yml)

A modern, highly polished Chrome extension that helps users discover keyboard shortcuts without leaving the page they are on.

## Install from GitHub

```bash
git clone https://github.com/SPGanesh-23/Shortcut-Hint-Overlay.git
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the cloned folder. To update after a new change: `git pull`, then click the reload ↻ button on the extension card in `chrome://extensions` and refresh your tabs — no need to load it again.


Inspired by ChatGPT's native UI, it detects when you hold the **Ctrl** key and seamlessly fades in a beautiful, unobtrusive overlay listing all relevant keyboard shortcuts.

## Features Built

### Phase 1: Core Overlay & Global Shortcuts
- **Long-Press Detection:** Holds off on showing the overlay until Ctrl is pressed for ~500ms. Smartly ignores quick taps (like `Ctrl+C`) or modifier combinations.
- **Shadow DOM Isolation:** The overlay is built entirely inside a closed Shadow DOM. This ensures that the extension's CSS cannot break the host website, and the host website's CSS cannot break the overlay.
- **Tier 1 (Global Chrome Shortcuts):** Always displays a curated list of standard Chrome shortcuts (New Tab, History, Zoom, etc.) that work everywhere.
- **Clean Fade Animations:** Smooth fade-in and transform animations using CSS transitions.

### Phase 2: DOM Auto-Detection (Context-Aware)
- Automatically scans the current page's HTML for hidden shortcuts.
- Looks for standard HTML attributes: `[accesskey]` and `[aria-keyshortcuts]`.
- Extracts a human-readable label using a smart fallback chain (`aria-label` → `title` → `alt` → `placeholder` → `innerText`).
- Dynamically creates a "THIS PAGE" section above the global shortcuts if any native shortcuts are detected (e.g., Wikipedia edit buttons).

### Phase 3: Curated JSON Database
- Introduced `shortcuts-db.json` to store clean, curated shortcuts for complex web apps (Gmail, YouTube, GitHub, Notion, etc.) that use custom JavaScript shortcuts instead of standard HTML attributes.
- The content script fetches this JSON on load.
- Seamlessly merges database shortcuts with auto-detected DOM shortcuts, automatically deduplicating them and giving priority to the curated JSON labels.
- Added support for site-specific warning notes (e.g., reminding users to enable shortcuts in Gmail settings).

### Phase 4: Polish & Disabled States
- **Light Mode Support:** Added a `@media (prefers-color-scheme: light)` block to the Shadow DOM. The overlay automatically switches to a stunning frosted white theme if the user's OS is in light mode.
- **Action Popup:** Clicking the extension icon in the Chrome toolbar opens a sleek popup menu that instantly displays the curated shortcuts for the current site.
- **Graceful Disabled State:** Added a `background.js` worker that disables and greys out the extension icon when navigating to restricted pages (like `chrome://` or the New Tab page) where content scripts cannot run.

### Phase 5: The Lock Feature
- **Pinning the UI:** Users can lock the overlay open so they don't have to continuously hold the Ctrl key while reading a long list.
- **How to Lock:** Press `Ctrl+Space` while the overlay is visible, or click anywhere inside the overlay panel. A lock icon (🔒) provides visual feedback, and the CSS box-shadow deepens.
- **Safety First (Zero Interference):** `Escape` and `Ctrl+Space` are strictly gated. The extension only intercepts these keystrokes if the overlay is already open, ensuring absolutely zero interference with other websites' normal keyboard behavior.
- **Unlock Triggers:** Pressing `Escape`, pressing `Ctrl+Space` again, or clicking anywhere outside the overlay panel instantly dismisses it.

---

## File Structure

- **`manifest.json`** — Manifest V3 configuration. Permissions are `activeTab`, `tabs` (background icon state + popup's active-tab lookup) and `storage`, and declares the background script, popup, and content script.
- **`shortcuts-db.json`** — The single source of truth for curated shortcuts. There is no separate seed file anymore (see v0.1.1 notes below).
- **`content.js`** — The heart of the extension. Contains the long-press logic, Shadow DOM UI generation, state machine (`hidden`, `visible`, `locked`), DOM auto-detection, and JSON fetching.
- **`shortcuts-db.json`** — A standalone database mapping domains (like `youtube.com`) to curated shortcut lists and optional prerequisite notes. Editable without touching JavaScript.
- **`background.js`** — A lightweight service worker that monitors tab changes and disables the extension icon on restricted URLs.
- **`popup.html / .css / .js`** — The UI for the toolbar popup.
- **`icons/`** — 16px, 48px, and 128px extension icons.

## Fixed in v0.1.1

1. **Disabled sites now actually work for `en.` / `m.` sites.** All three places (content script, popup, options page) now use the same `normalizeHost()` — lowercase + strip one leading `www.` / `en.` / `m.` — and stored entries are normalised before comparing, so legacy entries still match. Previously the popup stored `wikipedia.org` for `en.wikipedia.org` but the content script only stripped `www.`, so it never matched.
2. **Popup renders sequences / alternatives correctly.** The popup now uses the same `renderKeyCombo` parser as the overlay (`G, D` → G → D, `Tab then Q`, `S or /`, `K / Space`), instead of splitting only on `+`. The overlay parser also now handles ` or ` alternatives (`S or /` used to render as one big key).
3. **Database reconciled — `shortcuts-db.json` is now the single source of truth.** The unreferenced `shortcuts-db-seed.json` was removed. Restored shortcuts the live DB had dropped vs the seed: Gmail (Reply, Reply All, Delete, Mark as read/unread), Google Docs (Ctrl+K Insert link, Ctrl+B Bold), Gemini (Ctrl+/ Show shortcuts), YouTube (Shift+N / Shift+P next/previous, `/` focus search; `K` widened to `K / Space`). Wikipedia was unified: `wikipedia.org` now has the full 5 shortcuts and the duplicate `en.wikipedia.org` entry was removed (it resolves via the same normaliser). Deliberately *not* restored: GitHub `S or /` and `G then I/P/C` (already covered as separate rows / `G, I` sequences), ChatGPT/Claude entries that exist under spaced format, LeetCode (the seed had Run/Submit labels swapped — the DB mapping is the correct one), and Notion `Ctrl+N` (in Chrome that opens a new browser window, not a Notion page).

## Added in v0.1.2 — Search / Filter

- A search box at the top of the overlay (inside the Shadow DOM, dark + light themed). Type to live-filter by shortcut keys *or* label — e.g. `tab` finds `Ctrl + Tab` and `New tab`, `issues` finds GitHub's `G, I`.
- Search covers rows hidden behind "View more" too: while filtering, extra rows are shown and the toggle is hidden; clearing the query restores each section's previous collapsed/expanded state. Empty sections hide, and a "No shortcuts match …" message shows when nothing matches.
- How to use it: lock the overlay first (Ctrl+Space or click it), then click the search box — or just press `/` while locked to jump straight into it. First Esc while typing only clears the search; a second Esc closes the overlay. The query is cleared every time the overlay closes, so each open starts fresh.

## How to Test or Load
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the folder containing these files.
4. Open any standard webpage (e.g., Wikipedia, GitHub, Gmail) and hold **Ctrl** for 500ms!
