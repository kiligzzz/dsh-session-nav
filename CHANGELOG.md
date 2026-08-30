# Changelog

All notable changes to dsh-session-nav are tracked here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

## [0.1.5] - 2026-08-30

### Added

- 自动隐藏官方紧凑回合导航（`TurnNavigator`）：本插件钢琴键已是会话内导航的同位替代，安装即自动隐藏官方右侧「跳转到第 N 轮」竖排按钮，避免双导航并存。
  - 选择器：`div[class*="_marks"]`（容器）+ `button[aria-label^="跳转到第"]`（按钮，稳定中文文案锁定，跨 DSH 版本不依赖哈希类名）。
  - 实测目标：DSH 0.1.2 官方 `uEy0Ta_marks` 容器（28×70px，右侧 x=1232，8 个跳转按钮）。

### Fixed

- 钢琴键只在「对话」视图渲染：此前挂在 `shell.overlay`（frame-wide 浮动层），切到轨迹 / Agent 调度 / 记忆系统等 Tab 时钢琴键仍残留。现通过 MutationObserver 监测 `[data-conversation-scroll]` 容器存在性，非对话视图返回 null，其他 Tab 不再显示导航条。

## [0.1.4] - 2026-08-22

### Fixed

- 修复安装后启动崩溃（`ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/shared.js'`）：`package.json` `files` 白名单补齐 `lib/shared.js`，此前通过 npm / git 安装时该文件被过滤掉导致 DSH 恢复回滚。感谢 [@bakebakebakebake](https://github.com/bakebakebakebake) 的 PR #2。

## [0.1.3] - 2026-08-22

### Fixed

- 补 cordis peerDependencies（`^4.0.0-rc.7 || ^4.0.0`）：v0.1.2 发布时漏声明 cordis，且 npm 无 4.0.0 正式版导致商店校验警告。
- 版本号与 tag 对齐：v0.1.2 tag 指向的 package.json 实际 version 为 0.1.1，本版修正为 0.1.3。

## [0.1.2] - 2026-08-22

### Changed

- README: 默认简体中文（`README.md`），英文切换至 `README.en.md`；新增商店下载数 badge。
- peerDependencies 已覆盖 0.1.1-rc.2 宿主（`^0.1.0-rc.7 || ^0.1.1-rc.1`）。

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
