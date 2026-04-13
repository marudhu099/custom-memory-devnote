# Changelog

All notable changes to DevNote will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
