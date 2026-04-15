# DevNote — Phase 1 Reference

**What DevNote is (one line):** a VS Code extension that reads your git diff, asks Gemini to explain what you did, and saves that explanation as a page in your Notion database — so you never lose context on your own code.

Phase 1 shipped as **v0.2.0** (live on Open VSX). This doc is the single place to grasp how Phase 1 works before we touch Phase 2.

---

## The big picture (explain-it-to-a-child version)

DevNote has two halves that talk through a walkie-talkie:

- **The Brain** — TypeScript code running inside VS Code's extension host. It can touch git, call APIs, and hold secrets. This is everything in [src/](../../src/).
- **The Face** — plain HTML/CSS/JS running in a sandboxed webview panel in your sidebar. It can draw buttons and show text, but it cannot touch git, files, or the network. This is everything in [webview/](../../webview/).
- **The walkie-talkie** — VS Code's `postMessage` API. The Face shouts "user clicked Generate!" and the Brain shouts back "here's the finished note, show it on screen!".

This split exists for safety. The Face is sandboxed by VS Code so that if a webview ever loads something sketchy, it can't steal your API keys. All real work happens in the Brain.

---

## File map — who lives where

**Brain (7 files in [src/](../../src/)):**
- [extension.ts](../../src/extension.ts) — the front door. VS Code calls `activate()` when the extension starts.
- [SidebarProvider.ts](../../src/SidebarProvider.ts) — the conductor. Holds all the state machine logic and orchestrates every other service.
- [ConfigService.ts](../../src/ConfigService.ts) — the key ring. Reads/writes secrets.
- [GitService.ts](../../src/GitService.ts) — reads your diary (git diff).
- [LLMService.ts](../../src/LLMService.ts) — asks Gemini to explain the diary entry.
- [NotionService.ts](../../src/NotionService.ts) — delivers the explained note to your Notion filing cabinet.
- [DraftStore.ts](../../src/DraftStore.ts) — the safety locker. Holds in-flight notes so a failed sync never loses work.

**Face (3 files in [webview/](../../webview/)):**
- [sidebar.html](../../webview/sidebar.html) — one HTML file with **all 10 UI states** laid out as `<section hidden>` blocks. Only one is visible at a time.
- [sidebar.js](../../webview/sidebar.js) — vanilla JS. Wires buttons to `postMessage`, swaps visible state when the Brain says so.
- [sidebar.css](../../webview/sidebar.css) — the paint job.

No framework. No bundler. Just `tsc` and `@vscode/vsce`. This was deliberate — indie extension, zero build complexity.

---

## The flow — from click to Notion page

**Step 0 — Boot.** VS Code calls `extension.activate()`. It constructs `ConfigService`, `DraftStore`, and one `SidebarProvider`, then registers the sidebar view and one command (`devnote.create`, bound to `Ctrl+Alt+D`).

**Step 1 — Webview opens.** User clicks the DevNote activity-bar icon or hits the keybind. VS Code loads [sidebar.html](../../webview/sidebar.html) inside a webview. The JS sends `{ type: 'ready' }` to the Brain.

**Step 2 — Handshake.** `SidebarProvider.handleReady()` checks:
- Is there a leftover `custom_memory_note.md` from v0.1.x? Migrate it to a draft.
- Is there a draft in the safety locker? Show the draft banner.
- Are all 3 credentials (Gemini key, Notion token, Notion DB ID) set? No → show the **Setup** state. Yes → check git → show the **Idle** state with the current branch name.

**Step 3 — User clicks "Generate Doc".** Face sends `clickGenerate` → Brain shows the **Form** state. User types a title (required) and optional description, clicks "Generate".

**Step 4 — Build the diff payload.** `SidebarProvider.handleSubmitForm` asks `GitService`:
- If on a feature branch → `getBranchDiff()` returns `main...HEAD` diff + file list + commit count.
- If on `main` with uncommitted changes → `getUncommittedDiff()` returns staged + unstaged diffs.
- Both cases include uncommitted changes if they exist on a feature branch too.

**Step 5 — Ask Gemini.** `GeminiLLMService.generateNote(payload)` builds a prompt and calls the `@google/generative-ai` SDK via a **model fallback chain**: `gemini-2.5-flash` → `gemini-2.5-flash-lite`. If one model is overloaded or quota'd, it automatically tries the next. Returns a `StructuredNote` (title, summary, whatChanged[], why, filesAffected[], keyDecisions, timestamp).

**Step 6 — Preview.** The Brain holds `currentNote` in memory, tells the Face to show the **Preview** state. The Face renders every field of the structured note. User can go back or click **Save Note**.

**Step 7 — Local serialization (the big optimization).** `SidebarProvider.serializeNoteToMarkdown()` converts the `StructuredNote` directly to markdown **in pure JS, no LLM call**. This was the v0.2.0 critical fix — v0.1.x made a second Gemini call here for "structure for Notion"; we now halve API usage per saved note.

**Step 8 — Duplicate check.** `NotionService.findPageByTitle()` queries the Notion database for a page with the same title. If one exists, show the **Duplicate** state (Append / Replace / Cancel).

**Step 9 — Push to Notion.** `NotionService.push()` calls `POST /v1/pages` with the markdown converted into Notion blocks by `markdownToBlocks()` (supports `## headings`, `- bullets`, and paragraphs). Append uses `PATCH /v1/blocks/{id}/children`; Replace lists existing blocks, deletes each, then appends the new ones.

**Step 10 — Resolve.** Success → clear the draft, show **Success** state (user manually clicks "Back to Generate Doc"). Failure → `saveCurrentAsDraft()` stores everything in the safety locker, show **Sync Error** state. The draft banner now appears on every open until the user retries or discards.

---

## Per-file purpose (quick reference)

| File | Job | Depends on |
|---|---|---|
| [extension.ts](../../src/extension.ts) | Registers sidebar + command. That's it. | SidebarProvider, ConfigService, DraftStore |
| [SidebarProvider.ts](../../src/SidebarProvider.ts) | The 10-state machine. Every button press routes through here. | All services + webview |
| [ConfigService.ts](../../src/ConfigService.ts) | Gemini key + Notion token in `vscode.SecretStorage`. DB ID in workspace config. | `vscode.SecretStorage` |
| [GitService.ts](../../src/GitService.ts) | `simple-git` wrapper. Branch diff, uncommitted diff, base-branch detection (`main`/`master`). | `simple-git` |
| [LLMService.ts](../../src/LLMService.ts) | Gemini SDK wrapper with model fallback + retriable-error detection (`503/429/overloaded/quota`). | `@google/generative-ai` |
| [NotionService.ts](../../src/NotionService.ts) | Raw `fetch` to Notion REST API. Create, find, append, replace, markdown→blocks. | `fetch` (native) |
| [DraftStore.ts](../../src/DraftStore.ts) | Saves/retrieves one in-flight draft in `context.globalState`. | `vscode.ExtensionContext` |

---

## Why these decisions

- **Two-stage decoupled flow (generate then sync).** If Notion is down but Gemini worked, you don't lose the AI generation. Draft survives restarts.
- **Secrets in `SecretStorage`, not settings.** Plain settings sync across devices unencrypted. API keys must not leak.
- **One Gemini call per note (v0.2.0 fix).** Local markdown serialization removed the second "structure for Notion" call. Halved API usage and removed a whole failure mode.
- **Single markdown dialect end-to-end.** `serializeNoteToMarkdown` produces exactly what `markdownToBlocks` consumes. No schema drift.
- **Manual success state.** No `setTimeout` auto-redirect — prevents race conditions if the user clicks fast, and avoids the "wait, did it work?" feeling.
- **No bundler.** `tsc` compiles `src/*.ts` to `out/*.js`; vanilla JS webview ships as-is. Lower attack surface, faster ship cadence.
- **Open VSX only (for now).** Microsoft Marketplace signup was blocked on Azure DevOps card issues. Deferred, not abandoned.

---

## Known rough edges carried into Phase 2

- `SidebarProvider.ts` is ~643 lines and will cross 1500 if Phase 2 piles new states onto it without a refactor. The conductor needs to be split into smaller state-handler files before v0.5.0 (chat UI).
- `postMessage` is typed as `any` — no discriminated union. A typo in a new message kind will silently fail.
- `onDidReceiveMessage` handler isn't wrapped in a disposable. Fine for now; matters only if we ever re-resolve the view.
- No automated tests for the `SidebarProvider` message flow. Only `NotionService` has a unit test.
- After a successful sync, **the note is forgotten**. There is no local history. This is the single biggest thing Phase 2 changes.

---

**Continue the thread →** Phase 1 ends the moment a note lands in Notion. Phase 2 begins by refusing to forget it — see [docs/superpowers/specs/2026-04-14-devnote-v0.3.0-recent-notes-design.md](../superpowers/specs/2026-04-14-devnote-v0.3.0-recent-notes-design.md) (coming next) for the Recent Notes view, the first step toward turning DevNote from a one-way publisher into true AI memory for developers.
