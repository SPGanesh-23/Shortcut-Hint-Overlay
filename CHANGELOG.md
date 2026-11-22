# Changelog

All notable changes to Shortcut Hint Overlay are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-11-22

### Added
- Search / filter inside the overlay: a search box at the top of the panel,
  live-filtering by shortcut keys or label (e.g. `tab` finds `Ctrl + Tab`
  and `New tab`).
- Search covers rows hidden behind "View more" — while filtering, extra rows
  are shown and the toggle is hidden; clearing the query restores each
  section's previous collapsed/expanded state. Empty sections hide, and a
  "No shortcuts match …" message is shown when nothing matches.
- Press `/` while the overlay is locked to jump straight into the search box.
- First Esc while typing in the search box only clears the query; a second
  Esc closes the overlay. The query is cleared every time the overlay closes.

## [0.1.1] - 2026-11-22

### Fixed
- Disabled sites now work for `en.` / `m.` sites: content script, popup and
  options page all use the same `normalizeHost()` (lowercase + strip one
  leading `www.` / `en.` / `m.`), and stored entries are normalised before
  comparing. Previously the popup stored `wikipedia.org` for
  `en.wikipedia.org` but the content script only stripped `www.`, so it
  never matched.
- Popup key rendering: the popup now uses the same `renderKeyCombo` parser
  as the overlay, so sequences (`G, D` → G → D, `Tab then Q`) and
  alternatives (`S or /`, `K / Space`) render as separate keys. The overlay
  parser also now handles ` or ` alternatives (`S or /` used to render as
  one big key).
- Database reconciled: `shortcuts-db.json` is now the single source of truth
  and the unreferenced `shortcuts-db-seed.json` was removed. Restored
  shortcuts the live DB had dropped vs the seed: Gmail (Reply, Reply All,
  Delete, Mark as read/unread), Google Docs (Ctrl+K Insert link, Ctrl+B
  Bold), Gemini (Ctrl+/ Show shortcuts), YouTube (Shift+N / Shift+P
  next/previous, `/` focus search; `K` widened to `K / Space`). Wikipedia
  was unified: `wikipedia.org` now has the full 5 shortcuts and the
  duplicate `en.wikipedia.org` entry was removed.

### Changed
- Database: 105 sites, 243 shortcuts.
- README now states the real permissions (`activeTab`, `tabs`, `storage`)
  instead of "minimal `activeTab` only".

## [0.1.0] - 2026-11-22 (original build)

### Added
- Long-press Ctrl (~500 ms) shows a Shadow DOM overlay of keyboard shortcuts
  on any webpage; release Ctrl to hide it.
- Curated shortcut database (`shortcuts-db.json`) for 106 sites, plus DOM
  auto-detection via `[accesskey]` and `[aria-keyshortcuts]` for sites not
  in the database.
- Global Chrome shortcuts section (24 shortcuts), shown unless disabled.
- Lock feature: Ctrl+Space or clicking the panel locks the overlay open;
  Esc, Ctrl+Space again, or clicking outside closes it.
- Toolbar popup showing the current site's curated shortcuts, with a
  per-site enable/disable toggle.
- Options page: enable/disable, long-press duration (300–1000 ms), trigger
  key (Ctrl / Alt), lock combo, overlay position, theme (auto / light /
  dark), global-shortcuts toggle, disabled-sites list.
- Light-mode theme, background worker that disables the icon on restricted
  pages (`chrome://`, New Tab, Web Store).
