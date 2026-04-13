# Changelog

All notable changes to DevNote will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-12

### Added

- Persistent sidebar panel — DevNote now lives in the activity bar with a brain icon
- First-time setup wizard inside the sidebar — no more separate command palette flow
- Real-time progress indicators for generation and Notion sync (stepped loader)
- Draft recovery — unsynced notes persist across VS Code restarts and show as a banner
- Inline duplicate handling (Append / Replace / Cancel) directly in the sidebar
- Back navigation in the form/preview flow that preserves user input
- Gear icon for accessing settings any time after initial setup

### Changed

- All user interaction now happens in the sidebar instead of via input boxes and webview tabs
- `Ctrl+Alt+D` now opens the sidebar and auto-triggers note generation

### Removed

- `Ctrl+Alt+M` keybinding (sync is automatic on Save Note)
- `DevNote: Sync to Notion` command (replaced by sidebar Save Note button)
- `DevNote: Set Gemini API Key` command (replaced by sidebar settings)
- `DevNote: Set Notion Token` command (replaced by sidebar settings)
- Local `custom_memory_note.md` safety file (drafts now persist in extension state)
- Separate webview preview tab (preview is in the sidebar)

### Migration

- Existing users with a leftover `custom_memory_note.md` from v0.1.x will see it auto-converted to a draft on first sidebar open

## [0.1.1] — 2026-04-12

### Added

- "Save Note" in the preview panel now auto-syncs to Notion — no need to run the sync command separately in the happy path
- Duplicate title detection: if a Notion page with the same title already exists, a popup asks you to Append, Replace, or Cancel
- New brand icon — a neural-circuit brain representing "AI memory for developers"

### Changed

- `Ctrl+Alt+M` is now primarily a retry/manual sync command for cases when auto-sync fails or you cancel the duplicate popup
- All Notion sync error messages now explicitly tell you to retry with `Ctrl+Alt+M`

## [0.1.0] — 2026-04-12

### Added (initial release)

- Two-command flow: `Ctrl+Alt+D` to create notes, `Ctrl+Alt+M` to sync to Notion
- Git branch diff capture (primary) with uncommitted changes fallback
- Auto-detect base branch (main or master)
- Gemini AI note generation via `@google/generative-ai` SDK
- Local note storage as `custom_memory_note.md` (gitignored)
- Notion API integration for structured note sync
- Webview preview panel before save
- API key management via VS Code SecretStorage (Gemini + Notion)
- Error handling — never delete local file unless Notion sync succeeds
- Four commands: `DevNote: Create Dev Note`, `DevNote: Sync to Notion`, `DevNote: Set Gemini API Key`, `DevNote: Set Notion Token`
- Configuration setting: `devnote.notionDatabaseId`
