# Phase 1 Enhancement — Save Note Auto-Sync Design Spec

## Overview

Eliminate the separate `Ctrl+Alt+M` step for the happy path. When the user clicks "Save Note" in the preview panel, the extension automatically:

1. Saves the note locally as a safety net
2. Checks Notion for a page with the same title
3. If no match, creates a new page
4. If match found, asks the user to Append, Replace, or Cancel
5. Deletes the local file only after a successful Notion operation

`Ctrl+Alt+M` is kept as a retry command for sync failures, offline cases, and when the user cancels the duplicate popup.

---

## Motivation

The current MVP separates note creation and sync into two commands. Users have to remember to press `Ctrl+Alt+M` after `Ctrl+Alt+D` — and in practice, they forget. The "Save Note" button in the preview panel is the natural place to trigger the sync because:

- The user has already committed to keeping the note (that's what the button means)
- The title is already in memory — no need to re-prompt
- It's one click instead of two separate commands

`Ctrl+Alt+M` remains necessary for retry scenarios (offline, Notion API errors, user cancels popup) so the current command survives.

---

## Scope

### In scope

- Modify `CommandHandler.handleCreate()` to auto-sync after user approves preview
- Add 3 new methods to `NotionService`: `findPageByTitle`, `appendBlocksToPage`, `replacePageBlocks`
- Add a VS Code Quick Pick popup for duplicate title handling
- Update error messages to explicitly mention `Ctrl+Alt+M` retry
- Keep existing `handleSync` method intact for manual retries

### Out of scope

- Changes to `GitService`, `LLMService`, `ConfigService`, `NoteService`, `UIService`, `extension.ts`
- New UI components beyond the Quick Pick
- Automated tests (manual E2E testing is sufficient per user decision)
- Batch sync / history / undo features

---

## New Flow

```
... (existing: git check, API key, diff, user input, LLM, preview) ...
        ↓
[User clicks "Save Note" in preview]
        ↓
Step 7: NoteService.save(note)          — local safety net
        ↓
Step 8: Check Notion config
   ├─ Missing notion token or databaseId?
   │    → Warning: "Note saved locally. Set {thing} to enable sync."
   │    → STOP (local file stays)
   └─ Both configured → continue
        ↓
Step 9: NotionService.findPageByTitle(title)
   ├─ API error (network / auth / timeout)?
   │    → Error: "Failed to check for duplicate titles. Please try again with Ctrl+Alt+M."
   │    → STOP (local file stays)
   └─ Query succeeds → continue
        ↓
Step 10: Did a page with this title exist?
   ├─ NO  → LLM structures → NotionService.push(title, content) → delete local → success notification
   └─ YES → Show Quick Pick popup
                ├─ Append  → LLM structures → appendBlocksToPage(pageId, content) → delete local → success
                ├─ Replace → LLM structures → replacePageBlocks(pageId, content) → delete local → success
                └─ Cancel  → STOP (local file stays), info: "Sync cancelled — use Ctrl+Alt+M later"
        ↓
[Any Notion API failure during steps 10+]
   → Error notification mentioning Ctrl+Alt+M
   → Local file preserved
```

---

## Components

### `NotionService` — new methods

```typescript
// Query Notion database for a page with the given title
// Returns the pageId if found, null otherwise
// Uses POST /v1/databases/{databaseId}/query with title filter
async findPageByTitle(title: string): Promise<string | null>

// Append new content as blocks at the bottom of an existing page
// Uses POST /v1/blocks/{pageId}/children
// Reuses existing markdownToBlocks() helper
async appendBlocksToPage(pageId: string, content: string): Promise<void>

// Replace all content in an existing page (same page ID preserved)
// 1. GET /v1/blocks/{pageId}/children — list existing block IDs
// 2. DELETE /v1/blocks/{blockId} for each one
// 3. POST /v1/blocks/{pageId}/children — add new blocks
// Reuses existing markdownToBlocks() helper
async replacePageBlocks(pageId: string, content: string): Promise<void>
```

**Existing `push()` method:** unchanged. Still used for the no-duplicate path.
**Existing `markdownToBlocks()` helper:** unchanged, reused.

### `CommandHandler.handleCreate` — extended flow

The existing steps 1-6 (git check, API key, diff, user input, LLM, preview) are unchanged. After step 6 (user approves preview), new logic begins:

```
Step 7:  Save to custom_memory_note.md                 — existing NoteService.save()
Step 8:  Check Notion token + databaseId
Step 9:  Get Gemini key (needed for structureForNotion)
Step 10: LLMService.structureForNotion(noteContent)    — reused from existing handleSync
Step 11: NotionService.findPageByTitle(title)
Step 12: If no match → NotionService.push(title, structured)
         If match   → show Quick Pick → Append / Replace / Cancel
                       Append  → NotionService.appendBlocksToPage(pageId, structured)
                       Replace → NotionService.replacePageBlocks(pageId, structured)
                       Cancel  → STOP (local file stays)
Step 13: On any successful Notion operation → NoteService.delete()
Step 14: Show success notification (message varies by path)
Step 15: On any failure → show error with Ctrl+Alt+M retry instruction, keep local file
```

### `CommandHandler.handleSync` — unchanged

The existing manual-sync command stays exactly as-is. It still reads `custom_memory_note.md`, structures it for Notion, pushes, and deletes on success. Users fall back to this for retries.

**Intentional duplication:** The sync logic now exists in both `handleCreate` (happy path) and `handleSync` (retry path). That's acceptable for MVP — the duplication is minimal and both paths need to exist independently. If it becomes problematic later, we can extract a shared private helper.

### Quick Pick popup

Uses `vscode.window.showQuickPick` with three items:

| Label | Description | Detail |
|---|---|---|
| `$(add) Append` | Add new content below the existing page | Keeps history — old content is preserved, new content is added at the bottom |
| `$(replace-all) Replace` | Delete old content and replace with new | Keeps the same page URL, but old content is removed |
| `$(close) Cancel` | Abort sync and keep the local file | You can retry later with Ctrl+Alt+M |

Options:
- `placeHolder`: `"A page titled \"${title}\" already exists in Notion. What should we do?"`
- `ignoreFocusOut: true` — prevents accidental dismissal

Escape-key / dismissal is treated as `Cancel`.

---

## Error Handling

Every user-facing message is explicit. All failure messages mention `Ctrl+Alt+M` so the user knows how to retry.

| Scenario | Type | Text |
|---|---|---|
| Notion token missing | Warning | `DevNote: Note saved locally. Set Notion token with "DevNote: Set Notion Token" to enable sync.` |
| Notion database ID missing | Warning | `DevNote: Note saved locally. Set "devnote.notionDatabaseId" in settings to enable sync.` |
| Gemini API key missing (for structuring) | Error | `DevNote: Note saved locally. Gemini API key needed for Notion sync — please set it and retry with Ctrl+Alt+M.` |
| Duplicate check query failed | Error | `DevNote: Failed to check for duplicate titles. Your note is saved locally. Please try again with Ctrl+Alt+M.` |
| Create new page failed | Error | `DevNote: Failed to create Notion page — {reason}. Your note is saved locally. Please try again with Ctrl+Alt+M.` |
| Append blocks failed | Error | `DevNote: Failed to append to existing Notion page — {reason}. Your note is saved locally. Please try again with Ctrl+Alt+M.` |
| Replace blocks failed | Error | `DevNote: Failed to replace Notion page content — {reason}. Your note is saved locally. Please try again with Ctrl+Alt+M.` |
| User picks Cancel in popup | Info | `DevNote: Sync cancelled. Your note is saved locally — use Ctrl+Alt+M to sync later.` |
| Success: new page | Info | `DevNote: Note synced to Notion as a new page.` |
| Success: appended | Info | `DevNote: Note appended to existing Notion page "{title}".` |
| Success: replaced | Info | `DevNote: Notion page "{title}" replaced with new content.` |

### Key rule (invariant)

**The local `custom_memory_note.md` is only ever deleted after a successful Notion operation.** Any failure, cancellation, or error leaves the file in place so the user can retry with `Ctrl+Alt+M`.

---

## Testing

Manual E2E testing only. No new automated tests for this enhancement. The existing `test/NotionService.test.cjs` will be updated in a future pass if the code becomes more complex.

### Manual test scenarios

| # | Scenario | Expected |
|---|---|---|
| 1 | Happy path, new title | New Notion page created; `custom_memory_note.md` deleted; success notification |
| 2 | Happy path, Append | New blocks appended to existing page; local file deleted; success notification mentions "appended" |
| 3 | Happy path, Replace | Old blocks deleted, new blocks created in same page; page ID unchanged; local file deleted; success notification mentions "replaced" |
| 4 | Cancel flow | Popup dismissed via Cancel; local file stays; info notification mentions Ctrl+Alt+M |
| 5 | Popup Escape key | Same behavior as Cancel |
| 6 | Missing Notion token | Warning notification; local file stays; no Notion API calls made |
| 7 | Missing database ID | Warning notification; local file stays |
| 8 | Invalid Notion token (API 401) | Error mentions Ctrl+Alt+M; local file stays |
| 9 | Network failure during duplicate check | Error mentions Ctrl+Alt+M; local file stays |
| 10 | `Ctrl+Alt+M` retry after failure | Existing local file is re-read and synced successfully |

---

## Dependencies

No new npm packages. Uses existing:
- `simple-git` — unchanged
- `@google/generative-ai` — unchanged (already used in `structureForNotion`)
- Native `fetch` — unchanged (used in `NotionService`)
- VS Code API — `showQuickPick` is already available

---

## Files Affected

| File | Change | Estimated LOC |
|---|---|---|
| `src/NotionService.ts` | Add 3 new methods, no changes to existing code | +120 |
| `src/CommandHandler.ts` | Extend `handleCreate`, add `showDuplicateChoicePopup` private helper | +120 |

**No changes to:** `GitService`, `LLMService`, `ConfigService`, `NoteService`, `UIService`, `extension.ts`, `package.json`, `webview/preview.html`.

---

## Future-Proofing

- The existing `handleSync` method is preserved so users always have a retry path
- The Quick Pick UX can easily gain more options later (e.g., "Create as new anyway")
- `findPageByTitle` returns `Promise<string | null>` — extendable to return multiple matches if we ever support fuzzy matching
- The new flow keeps `NoteService` as the single source of truth for the local file — unchanged, no behavior drift

---

## What's NOT in this spec

- Automatic conflict resolution (always asks user)
- Fuzzy title matching (only exact match)
- Multi-page handling (if two pages exist with the same title, we just use the first one — extremely rare edge case)
- Undo / revert functionality for Replace operations
- Batch operations
- Offline queue (still requires manual `Ctrl+Alt+M` retry)
- Changes to the preview panel UI
- Changes to the `Ctrl+Alt+M` retry logic
