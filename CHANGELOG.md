# Changelog

All notable changes to Shortcut Hint Overlay are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.6] - 2026-11-23

### Removed
- All Mac support, and the extension is Windows-only for now. The v0.1.3
  Ctrl -> Cmd label swap and the v0.1.5 override table (8 entries) were
  both partial: they fixed Chrome's own shortcuts but left every site
  shortcut as a guessed swap, with no Mac to live-test on. Doing it
  halfway is worse than not doing it, so it is all removed — the
  `MAC_KEY_OVERRIDES` table, the `localizeKeys` / `localizeKey` code, and
  `tests/mac.test.js`. A full Mac version, with Mac keys checked site by
  site like Windows, is planned for a future release. The v0.1.3 and
  v0.1.5 entries below are kept as history.

## [0.1.5] - 2026-11-23

### Fixed
- Proper Mac key table (the v0.1.3 Ctrl -> Cmd label swap was not enough):
  History is `Cmd + Y` (not `Cmd + H`, which hides Chrome), Downloads is
  `Cmd + Shift + J`, DevTools is `Cmd + Option + I`, Back / Forward are
  `Cmd + [ / ]`, Fullscreen is `Cmd + Ctrl + F`, and Next / Previous tab
  stay `Ctrl + Tab` / `Ctrl + Shift + Tab` (Cmd + Tab switches apps).
  The overrides live in `MAC_KEY_OVERRIDES` in `content.js` and are
  covered by the Mac overlay test. Other keys still map generically
  (Ctrl -> Cmd, Alt -> Option). Not live-tested on a Mac — no Mac was
  available — so this is verified by automated tests only.

## [0.1.4] - 2026-11-22

### Added
- Accessibility: the overlay is now a `dialog` with labelled `list` /
  `listitem` rows, a lock button with `aria-pressed`, a "View more" toggle
  with `aria-expanded` / `aria-controls`, and Arrow Up/Down, Home and End
  navigation between visible rows (roving tabindex). Locking moves keyboard
  focus into the search box. Visible focus outlines for rows, the toggle,
  the search box and the lock icon. Covered by 5 new tests
  (`tests/accessibility.test.js`).
- Onboarding: the welcome page (`welcome.html`) opens once on first
  install and teaches the Ctrl hold, Ctrl+Space lock, `/` search and
  arrow-key navigation, with links to Options and to try it on GitHub.
  Covered by `tests/onboarding.test.js`.
- Store assets: `PRIVACY.md` (the extension collects nothing) and
  `store-listing.md` (Web Store description, category, and the 5
  screenshots to take).

### Changed
- Test suite is now 43 tests, all passing; lint clean.

## [0.1.3] - 2026-11-22

### Added
- Automated test suite (`npm test`, 32 tests, Node's built-in runner): manifest
  and icon validation, `shortcuts-db.json` structure checks, `renderKeyCombo`
  key-rendering cases, `normalizeHost` cases, and a fake-DOM harness that
  loads the real `content.js` and exercises the search/filter behaviour
  (filter, no-match, Esc to clear, reopen, `/` to focus, click to lock).
- ESLint (`npm run lint`) with a flat config for the browser extension code
  and the Node tests.
- GitHub Actions CI (`.github/workflows/ci.yml`): runs `npm ci`, `npm test`
  and `npm run lint` on every push and pull request, with a CI badge in the
  README.
- Mac support: on macOS the overlay and popup now display `Cmd` / `Option`
  instead of `Ctrl` / `Alt` (e.g. `Cmd + T`, `Option + ←`). The data stays
  in its Windows form and is localised at render time only; the extension's
  own trigger stays a Ctrl long-press on every platform. Covered by 3 new
  tests in `tests/mac.test.js`, plus a regression test for the label fixes
  below (36 tests total).
- `.gitattributes` forcing LF line endings, so Windows checkouts no longer
  produce "LF will be replaced by CRLF" warnings on `git add`.

### Fixed
- Google Sheets: `Alt+Enter` is "Insert line break in cell", not "Insert note".
- Facebook: J/K/L/C navigate posts, not stories — labels corrected.

### Known limitations
- The shortcut database was checked by hand for the top 25 sites; the
  remaining 80 sites have not been individually verified against official
  sources, and a few entries (e.g. ChatGPT, Claude, Slack, Spotify, Drive)
  are still unconfirmed. The live web search used for that check failed,
  so this is recorded here rather than guessed at.

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
