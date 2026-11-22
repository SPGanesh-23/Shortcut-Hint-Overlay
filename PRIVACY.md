# Privacy Policy — Shortcut Hint Overlay

_Last updated: 22 November 2026_

Shortcut Hint Overlay is a Chrome extension by Shree Pranava Ganesh N R.
It shows you the keyboard shortcuts for the website you are on.

## What we collect

**Nothing.** The extension collects, stores, transmits, and sells no personal
information and no browsing data of any kind.

## What the extension does with your data

- **Your settings** (whether the overlay is enabled, long-press duration,
  trigger key, lock combo, position, theme, global-shortcuts toggle, and
  your disabled-sites list) are stored in Chrome's `chrome.storage.sync`,
  on your own Google account's synced storage, so your settings follow you
  between your own Chrome browsers. They are never sent to us or to anyone
  else.
- **The shortcut database** (`shortcuts-db.json`) is bundled with the
  extension. It is read locally; no request is made to any server.
- **The pages you visit** are only used locally, in your browser, to decide
  which site's shortcuts to show. No URL, page content, or keystroke is
  sent anywhere.
- **No analytics, no ads, no trackers, no third-party requests.**

## Permissions — why each one is needed

- `activeTab` / `tabs` — to know which site the current tab is on (so the
  popup can show that site's shortcuts) and to grey out the icon on pages
  where content scripts cannot run (e.g. `chrome://` pages).
- `storage` — to save your settings listed above.

## Changes

If this policy changes, the new version will be published here in the
repository. Questions: open an issue at
https://github.com/SPGanesh-23/Shortcut-Hint-Overlay/issues
