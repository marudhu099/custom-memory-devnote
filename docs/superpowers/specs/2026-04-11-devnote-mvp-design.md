# DevNote — Phase 1 MVP Design Spec

## Overview

DevNote is a VS Code extension that generates structured developer notes from git changes. Notes are saved locally as `custom_memory_note.md` (gitignored) and synced to Notion on demand.

This spec covers the Phase 1 MVP: two-command flow, Gemini SDK, local storage, manual Notion sync.

---

## Architecture: Two-Command Flow

### Why two commands

Decoupled by design. The create flow and sync flow are independent. When sync moves from manual to automatic in Phase 2+, only the sync side changes. The create flow stays untouched.

### Command 1 — Create Note (`Ctrl+Alt+D`)

```
GitService.checkAvailability()    → repo exists? on a branch?
GitService.getBranchDiff()        → git diff main...HEAD (primary — entire branch)
GitService.getUncommittedDiff()   → staged + unstaged (secondary — if any)
User input                        → title + optional notes
LLMService.generateNote()         → Gemini generates structured note
UIService.showPreview()           → webview preview panel
User approves/edits
NoteService.save()                → writes custom_memory_note.md
```

### Command 2 — Sync to Notion (`Ctrl+Alt+M`)

```
NoteService.read()                → read custom_memory_note.md
LLMService.structureForNotion()   → LLM formats for Notion blocks
NotionService.push()              → creates page in Notion database
NoteService.delete()              → deletes local file
Success notification
```

---

## Commands & Keybindings

| Command | ID | Keybinding | Purpose |
|---|---|---|---|
| Create Dev Note | `devnote.create` | `Ctrl+Alt+D` | Generate and save note locally |
| Sync to Notion | `devnote.sync` | `Ctrl+Alt+M` | Push note to Notion, delete local |
| Set Gemini API Key | `devnote.setGeminiKey` | None (Palette) | Store Gemini key in SecretStorage |
| Set Notion Token | `devnote.setNotionToken` | None (Palette) | Store Notion token in SecretStorage |

---

## File Structure

```
devnote/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts          ← entry point, registers all commands
│   ├── CommandHandler.ts     ← orchestrates both flows
│   ├── GitService.ts         ← check availability, get staged + unstaged diff
│   ├── LLMService.ts         ← interface + Gemini impl (generate note + structure for Notion)
│   ├── UIService.ts          ← webview preview panel
│   ├── ConfigService.ts      ← SecretStorage (Gemini key + Notion token) + settings
│   ├── NoteService.ts        ← read/write/delete custom_memory_note.md
│   └── NotionService.ts      ← push structured data to Notion API
├── webview/
│   └── preview.html
└── .gitignore                ← includes custom_memory_note.md
```

---

## Services Detail

### GitService

- `checkAvailability()`: Confirms workspace is a git repo and has changes (branch diff or uncommitted)
- `isOnMainBranch()`: Returns whether current branch is main/master
- `getBranchDiff()`: Returns `{ branchDiff: string, filesChanged: string[], commitCount: number }` — entire branch diff vs main (primary)
- `getUncommittedDiff()`: Returns `{ staged: string, unstaged: string, filesChanged: string[] }` — uncommitted changes (secondary/fallback)
- Uses `simple-git` npm package

### ConfigService

- `getGeminiApiKey()` / `setGeminiApiKey()`: SecretStorage for Gemini key
- `getNotionToken()` / `setNotionToken()`: SecretStorage for Notion token
- `getNotionDatabaseId()`: VS Code settings (`devnote.notionDatabaseId`)

### LLMService

- Interface pattern — swappable to Claude/OpenAI later (one-file change)
- `generateNote(payload)`: Sends diff + context to Gemini, returns structured note
- `structureForNotion(noteContent)`: Formats note for Notion's block structure
- Uses `@google/generative-ai` SDK

### UIService

- `showPreview(note)`: Opens webview panel with generated note
- User can approve or reject
- Vanilla HTML/JS — no React for MVP

### NoteService

- `save(note)`: Writes structured note to `custom_memory_note.md` in workspace root
- `read()`: Reads and parses `custom_memory_note.md`
- `delete()`: Removes the file after successful Notion sync
- `exists()`: Checks if a note exists (used by sync command)

### NotionService

- `push(structuredData)`: Creates a page in the user's Notion database
- Uses Notion API (REST via fetch — no extra SDK dependency for MVP)

---

## Configuration & Secrets

### Secrets (SecretStorage — OS keychain)

| Key | Purpose |
|---|---|
| `devnote.geminiApiKey` | Gemini API key for note generation |
| `devnote.notionToken` | Notion integration token for sync |

### Settings (VS Code settings.json)

| Key | Purpose |
|---|---|
| `devnote.notionDatabaseId` | Target Notion database ID |

---

## Error Handling

### Command 1 — Create Note

| Step | Error | Response |
|---|---|---|
| Git check | Not a git repo | Notification: "Open a git repository to use DevNote" |
| Git check | No uncommitted changes | Notification: "No changes found — make some changes first" |
| User input | User cancels title prompt | Flow stops silently |
| Gemini API | No API key set | Notification + prompt to set key |
| Gemini API | Call fails (network/quota) | Notification: "Failed to generate note — check your API key and connection" |
| Preview | User rejects note | Flow stops, nothing saved |

### Command 2 — Sync to Notion

| Step | Error | Response |
|---|---|---|
| Read file | No `custom_memory_note.md` | Notification: "No note to sync — create one first with Ctrl+Alt+D" |
| Notion API | No token set | Notification + prompt to set token |
| Notion API | Push fails | Notification: "Sync failed." Local file NOT deleted (retry safe) |

**Key rule:** Never delete `custom_memory_note.md` unless Notion sync succeeds. No data loss.

---

## Git Changes Captured

**Primary:** Branch diff vs main (`git diff main...HEAD`) — the entire branch's changes across all commits. This is the same diff you see in a PR.

**Secondary:** Uncommitted changes (staged + unstaged) — included alongside the branch diff if any exist.

**Fallback:** If on main branch, only uncommitted changes are captured.

---

## Dependencies (MVP)

| Package | Purpose |
|---|---|
| `@google/generative-ai` | Gemini SDK (free API key) |
| `simple-git` | Git integration |
| `typescript` | Compiler |
| `@types/vscode` | VS Code API types |
| `@types/node` | Node.js types |

Notion API is called via native `fetch` — no extra SDK needed.

---

## What's NOT in MVP

- Memory layer / SQLite index (Phase 2)
- Context injection from past notes (Phase 2)
- TreeView sidebar (Phase 2)
- Automatic Notion sync (Phase 2+)
- Python bridge (Phase 3)
- Multi-LLM support (Phase 4)
- Onboarding screen (deferred — set API key command is enough for now)

---

## Future-Proofing

- `LLMService` is an interface — swap Gemini for Claude/OpenAI by implementing one class
- Two-command split means automatic sync replaces only `devnote.sync`, leaving `devnote.create` untouched
- `NoteService` abstraction means the local file format is customizable without touching other services
