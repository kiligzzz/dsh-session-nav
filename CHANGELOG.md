# Changelog

All notable changes to dsh-session-nav are tracked here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- Unit test suite (vitest): host question extraction, shared text/geometry
  helpers, cluster pitch compression — 31 tests.
- GitHub Actions CI: node 20/22 matrix running the full test suite.
- ESLint + Prettier configs and npm scripts.
- Keyboard navigation: arrow keys move the hover/focus index within the key
  strip; `aria-current` marks the active key; the strip exposes a group
  role with a descriptive label.
- Transient user-facing notice when a jump degrades (no paging handle,
  history load failure, or target not found).
- Narrow-window guard: tooltip and notice clamp to the viewport width.

### Changed

- Extracted pure helpers (`blockText`, `textOfBlocks`, `clampModelText`,
  `keyIdentity`, `computeCluster`, `sameLayout`) into `lib/shared.js`,
  imported by both the host and browser halves and unit-tested once.

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
