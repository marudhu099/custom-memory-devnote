# Changelog

All notable changes to DevNote will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-04-18

### Added

- 🔍 Semantic search over all past notes — type a natural-language query, get results ranked by meaning (not keywords)
- Search input above Recent Notes in the sidebar; morphing header shows mode
- Similarity score badge on each result (e.g. `87% · 2h`)
- One-time Python environment setup flow on first search (venv + pip install)
- One-time backfill indexing for existing notes (uses Gemini batch embedding API)
- "Reset Python environment" button in Settings (power-user recovery)
- "Re-index all notes" button in Settings (after embedding model changes)
- TypeScript + Python hybrid architecture — Python worker runs as a child process, JSON-RPC over stdin/stdout

### Changed

- Note sync now also embeds the note locally (best-effort — failures toast a gentle warning and defer indexing to the next search)
- Sidebar idle state: Recent Notes section gains a 🔍 search input above it
- Description updated in package.json to reflect semantic search capability

### Requires

- Python 3.10+ installed on your machine (DevNote will prompt on first search if missing)

### Notes

- Embeddings use `gemini-embedding-001` (Google AI Studio, 3072-dim, L2-normalized) via the `google-genai>=0.8.0` SDK
- Older SDK (`google-generativeai==0.8.3`) used v1beta endpoint which no longer serves `embedContent` for AI Studio keys; migration required for first release

## [0.3.0] — 2026-04-16

### Added

- Recent Notes — your past notes now appear in the sidebar below Generate Doc, stored locally and viewable instantly without leaving VS Code
- Local SQLite storage (sql.js) — every synced note is saved to devnote.db on your machine, forming the foundation for future search and memory features
- Click any past note to preview it inline from local storage (no network needed)
- "Open in Notion" link in the preview for sharing and mobile access
- "Clear all memory" button in Settings with confirmation popup and optional backup export
- Empty state for new users: "Your notes will appear here once you generate your first one."

### Changed

- Idle state now shows the Recent Notes list below the Generate Doc button
- Preview state now supports historical notes (read-only, no Save/Discard)
- Settings panel has a new "Clear all memory" section at the bottom
- NotionService.push() now returns page ID and URL for local storage

## [0.2.1] — 2026-04-14

### Fixed

- Republish to force Open VSX to re-extract the README. v0.2.0 hit an Open VSX CDN propagation issue where `readme.md` returned a 403 on the extension page. No code changes.

## [0.2.0] — 2026-04-14

### Added

- Persistent sidebar panel — DevNote now lives in the activity bar with a dedicated brain icon
- First-time setup wizard inside the sidebar — no more separate command palette flow
- Real-time progress indicators for generation and Notion sync
- Draft recovery — unsynced notes persist across VS Code restarts and show as a banner
- Inline duplicate handling (Append / Replace / Cancel) directly in the sidebar
- Back navigation in the form, preview, and setup screens that preserves user input
- Gear icon for accessing settings any time after initial setup
- Automatic Gemini model fallback (`gemini-2.5-flash` → `gemini-2.5-flash-lite`) when the primary model is overloaded or rate-limited

### Changed

- All user interaction now happens in the sidebar instead of via input boxes and webview tabs
- `Ctrl+Alt+D` now opens the sidebar and auto-triggers note generation
- "Save Note" no longer makes a second Gemini call to restructure the markdown — the local serializer feeds Notion directly, halving API usage and avoiding a redundant failure point
- Sync success state now stays visible until you click "Back to Generate Doc" instead of auto-dismissing after a few seconds
- Error states now surface the underlying Gemini/Notion error message so quota, network, and auth issues are diagnosable at a glance, with friendly summaries for the common 503 overload and 429 quota cases

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
