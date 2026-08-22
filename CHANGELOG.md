# Changelog

All notable changes to dsh-session-nav are tracked here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-08-22

### Fixed

- Startup race: the browser half now retries the full-history questions fetch
  (500ms then 1000ms) instead of giving up once. On a fresh launch the current
  session's log may not be flushed to disk yet, so the first fetch could fail
  with "session not found" and permanently drop the full-history navigation
  keys. Retrying after the log lands restores them.

### Changed

- Widened `peerDependencies` for `@deepseek-ai/dsh-client-runtime` and
  `@deepseek-ai/dsh-client-ui-slots` to `^0.1.0-rc.7 || ^0.1.1-rc.1` so the
  plugin declares compatibility with the 0.1.1 harness line.

## [0.1.0] - 2026-08-20

Initial release: piano-key in-conversation navigation bar for the DeepSeek
Harness Web GUI.

### Added

- One navigation key per real user message (host reads the full on-disk
  session log; merged with the live window and deduplicated by UUID).
- Hover ladder (26/20/14/10px), turn-preview tooltip (user message + up to
  3-line model reply), active-message highlight on scroll, click-to-jump
  with bounded history paging.
- Light/dark theme via `data-ds-dark-theme` + `prefers-color-scheme`.
- Hides the strip while a full-screen modal (e.g. settings) is open.
