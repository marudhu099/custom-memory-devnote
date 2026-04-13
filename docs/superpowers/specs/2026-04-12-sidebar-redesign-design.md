# DevNote Sidebar Redesign — Design Spec

## Overview

Transform DevNote from a command-driven extension into a sidebar-driven product. Replace input boxes, webview preview panels, and command-palette flows with a single persistent sidebar panel that handles setup, generation, preview, sync, and error recovery.

This is a major UX overhaul motivated by real user feedback after the v0.1.1 launch on Open VSX. Users reported that the extension felt "hidden" and gave no feedback during async operations.

---

## Motivation

After publishing DevNote v0.1.1 to Open VSX, real user feedback identified four pain points:

1. **The extension feels hidden** — users had to remember a keyboard shortcut to use it
2. **No progress when generating** — silence between pressing the shortcut and seeing the preview
3. **No progress when syncing** — silence between clicking Save and the success notification
4. **No guided flow** — users wanted a stepper-style experience instead of a blur of input boxes

The fix is to make DevNote **visible, interactive, and guided** by giving it a dedicated sidebar panel that shows real-time state at every step.

---

## Goals

- DevNote becomes visible in the VS Code Activity Bar (left vertical strip)
- All user interaction happens in the sidebar — no more popup input boxes or separate webview tabs
- Every async operation shows clear progress (loading state with stepped text)
- Every error shows clear messaging with retry options
- Settings live in the sidebar (gear icon + first-time setup form)
- Power-user shortcut still works as a fast-path entry into the same sidebar flow

---

## Non-Goals

- Note history / past notes browsing — deferred to Phase 2 (planned as paid feature)
- SQLite memory index — Phase 2
- Context injection from past notes — Phase 2
- Branch change auto-detection / live refresh — deferred for simplicity
- Multiple drafts at once — only one draft allowed at a time
- API key validation at save time — keys are saved as-is, errors surface on first use
- Automated tests — manual E2E only, consistent with previous releases

---

## Capture Scope (Unchanged)

DevNote captures the same content as v0.1.1:

- **Primary**: branch diff vs main/master (`git diff main...HEAD`) — the entire branch's changes
- **Secondary**: any uncommitted staged or unstaged changes, included alongside the branch diff
- **Fallback**: if on main/master, uncommitted changes only

No PR is required. Local git is the only source of truth. This works offline and supports any git host.

---

## Architecture

### What stays unchanged

| Component | Reason |
|---|---|
| `GitService.ts` | Branch diff + uncommitted detection logic is unchanged |
| `LLMService.ts` | Gemini calls (`generateNote`, `structureForNotion`) are unchanged |
| `NotionService.ts` | All four methods (`push`, `findPageByTitle`, `appendBlocksToPage`, `replacePageBlocks`) are unchanged |
| `ConfigService.ts` | SecretStorage and settings access are unchanged |

The backend services keep working exactly as they do today. This redesign is a **frontend rewrite** — the sidebar becomes the new orchestrator instead of `CommandHandler`.

### What changes

| Component | Change |
|---|---|
| `extension.ts` | Registers a new sidebar webview view provider + the single remaining command. Removes old command registrations. |
| `package.json` | Adds `viewsContainers.activitybar` and `views.devnote-sidebar` contributions. Removes 3 of 4 commands and the `Ctrl+Alt+M` keybinding. |
| `CommandHandler.ts` | Largely replaced. Becomes thin orchestrator called by the sidebar provider, or removed entirely if sidebar provider handles orchestration directly. |

### What gets removed

| Component | Reason |
|---|---|
| `UIService.ts` | The webview preview panel is no longer needed — preview lives inside the sidebar. |
| `NoteService.ts` | The local `custom_memory_note.md` file is no longer used as a safety net. Drafts live in extension state. |
| `webview/preview.html` | Replaced by the new `webview/sidebar.html`. |

### What gets added

| File | Responsibility |
|---|---|
| `src/SidebarProvider.ts` | VS Code `WebviewViewProvider` implementation. Manages the sidebar lifecycle, message passing between extension and webview, and orchestrates the full flow (replaces `CommandHandler`). |
| `src/DraftStore.ts` | Persistent draft storage using `vscode.ExtensionContext.globalState`. Loads/saves the single in-flight draft for recovery across VS Code restarts. |
| `webview/sidebar.html` | The single HTML file that renders all sidebar states (setup, idle, form, loading, preview, syncing, success, error, draft recovery, duplicate prompt). |
| `webview/sidebar.css` | Styles for all sidebar states. Uses VS Code theme tokens for native look. |
| `webview/sidebar.js` | Webview-side JavaScript: state management, message passing to extension host, DOM rendering. |
| `media/loader.svg` (or similar) | Brand loader animation (neural-circuit pulse matching the icon). |

---

## Sidebar States

The sidebar has 11 distinct states. The webview renders one at a time based on messages from the extension host.

### State 1: First-time setup (no tokens saved)

```
🧠 DevNote                          ⚙️

Setup DevNote before using:

Gemini API Key
[___________________________]
Get your free key →

Notion Integration Token
[___________________________]
How to create one →

Notion Database ID
[___________________________]
How to find it →

[       Save       ]
```

**Trigger:** Sidebar opens AND any of the 3 config values is missing.
**Action:** User fills 3 fields → clicks Save → values stored (Gemini + Notion token in SecretStorage, DB ID in workspace settings) → transitions to State 2.
**Validation:** None at save time. Empty fields show inline errors. Invalid keys discovered at first use.

### State 2: Idle (setup complete, ready to generate)

```
🧠 DevNote                          ⚙️

📍 feat/login

[    Generate Doc    ]
```

**Trigger:** Sidebar opens AND all 3 config values exist AND no draft pending.
**Branch indicator:** Shows current branch name. No file count.
**Generate Doc button:** Enabled when there are changes to capture. Disabled with a one-line reason underneath when not.

**Disabled states:**
- "Not a git repository."
- "No changes to document yet."
- "You're on main — nothing to document."

### State 3: Form (after clicking Generate Doc)

```
🧠 DevNote                          ⚙️

📍 feat/login

Title (required)
[___________________________]

Description (optional)
[___________________________]
[___________________________]

[ ← Back ]    [    Generate    ]
```

**Trigger:** User clicks Generate Doc in State 2.
**Back button:** Returns to State 2, discards form data.
**Generate button:** Disabled until title is non-empty. Click → State 4.

### State 4: Generating (loading)

```
🧠 DevNote                          ⚙️

📍 feat/login

[brand loader animation]

Generating note with Gemini...
```

**Trigger:** User clicked Generate in State 3.
**Behavior:** Extension calls `LLMService.generateNote()`. Loader shows brand animation. On success → State 5. On failure → State 6.
**Cancellation:** If sidebar is closed mid-generation, the API call is aborted via AbortController. State is wiped.

### State 5: Preview (note ready, awaiting save)

```
🧠 DevNote                          ⚙️

[ ← Back ]

Title: Fix login token expiration
─────────────────────────────────

Summary
Fixed token expiration check that was comparing
timestamps as strings instead of Date objects.

What Changed
• Modified login.ts to use Date object comparison
• Updated token.ts utility to return Date

Why
Users were getting logged out randomly because
string comparison of ISO timestamps gave wrong
results for certain date ranges.

Key Decisions
Chose Date objects over unix timestamps for
readability.

Files Affected
• src/auth/login.ts
• src/utils/token.ts

[   Save Note   ]   [   Discard   ]
```

**Trigger:** Generation succeeded.
**Back button:** Returns to State 3 (Form) with title/description preserved.
**Save Note:** Triggers sync flow → State 7.
**Discard:** Returns to State 2 (Idle), wipes generated note.

### State 6: Generation error

```
🧠 DevNote                          ⚙️

📍 feat/login

[ Generate Doc ]

❌ Couldn't generate note. Please try again.

[ 🔁 Retry ]
```

**Trigger:** `LLMService.generateNote()` threw an error.
**Error message:** Short and friendly. No technical details.
**Retry button:** Re-runs generation with the same title/description from State 3 (preserved in memory).

### State 7: Syncing (stepped loader)

```
🧠 DevNote                          ⚙️

[brand loader animation]

Preparing note...
```

Then transitions through:
```
Checking Notion...
```
```
Syncing to Notion...
```

**Trigger:** User clicked Save Note in State 5.
**Behavior:** Extension runs the sync sequence:
1. Set state text "Preparing note..." → call `LLMService.structureForNotion()`
2. Set state text "Checking Notion..." → call `NotionService.findPageByTitle()`
3. Set state text "Syncing to Notion..." → call `NotionService.push()` (or append/replace)

On duplicate detected → State 8. On success → State 9. On failure → State 10.
**Cancellation:** If sidebar is closed, abort the sync. Save the note as a recoverable draft.

### State 8: Duplicate detected (inline choice)

```
🧠 DevNote                          ⚙️

⚠️ A note titled "Fix login bug" already
exists in your Notion database.

What do you want to do?

[ ➕ Append ]
Add new content below the existing page

[ 🔄 Replace ]
Delete old content, use new content
(same page URL preserved)

[ ✕ Cancel ]
Keep the draft and decide later
```

**Trigger:** `findPageByTitle()` returned a page ID.
**Append:** → State 7 ("Syncing to Notion...") → calls `appendBlocksToPage()`
**Replace:** → State 7 ("Syncing to Notion...") → calls `replacePageBlocks()`
**Cancel:** Saves the in-memory draft via `DraftStore`, returns to State 2 with a draft banner (State 11).

### State 9: Sync success

```
🧠 DevNote                          ⚙️

✅ You got it! Note synced to Notion.
```

**Trigger:** Notion sync (push, append, or replace) succeeded.
**Behavior:** Shows success message for 3 seconds, then transitions to State 2 (Idle). Draft is cleared from `DraftStore`.

### State 10: Sync error

```
🧠 DevNote                          ⚙️

📍 feat/login

[ Generate Doc ]

❌ Couldn't sync to Notion. Please try again.

[ 🔁 Retry ]
```

**Trigger:** Any Notion API call failed during the sync sequence.
**Error message:** Short and friendly. No technical details.
**Retry button:** Re-runs the sync from "Preparing note..." with the same generated note (preserved in `DraftStore`).
**Note:** The generated note is saved as a draft via `DraftStore` so it survives sidebar close / VS Code restart.

### State 11: Draft recovery banner

```
🧠 DevNote                          ⚙️

⚠️ Unsynced draft from yesterday
Title: Fix login bug
Last error: Notion API timeout

[ 🔁 Retry Sync ]    [ 🗑 Discard ]

─────────────────

📍 feat/login

[ Generate Doc ]   ← DISABLED while draft pending
```

**Trigger:** Sidebar opens AND `DraftStore` has a saved draft.
**Banner contents:**
- Relative time of when the draft was created
- Title of the unsynced note
- Last error message that caused the failure

**Retry Sync:** → State 7 (sync sequence) using the saved draft.
**Discard:** Removes draft from `DraftStore`, banner disappears, returns to State 2 (Idle).

**Generate Doc disabled:** While a draft is pending, the user cannot start a new note. Must resolve (retry succeed OR discard) first.

---

## Component Detail

### `SidebarProvider.ts` (new)

Implements `vscode.WebviewViewProvider`. Manages:

- Webview lifecycle (resolve, dispose, hide, show)
- HTML/CSS/JS resource loading and CSP setup
- Message passing between extension host and webview JavaScript
- Orchestration of GitService, LLMService, NotionService calls
- AbortController management for cancellation
- Draft persistence via `DraftStore`

**Public API:**
```typescript
class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'devnote.sidebar';

  constructor(
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext,
    private configService: ConfigService
  );

  resolveWebviewView(view: vscode.WebviewView): void;

  // External trigger from Ctrl+Alt+D shortcut
  triggerGenerate(): Promise<void>;
}
```

**Message contract** (extension ↔ webview):

Extension → Webview:
- `setState({ state: SidebarState, data?: any })` — render a specific state
- `setLoadingText(text: string)` — update loading text in stepped sync
- `setBranchInfo({ branch: string, canGenerate: boolean, reason?: string })` — update branch indicator + button enabled state
- `setDraft(draft: DraftData | null)` — show/hide draft recovery banner

Webview → Extension:
- `saveSetup({ geminiKey, notionToken, notionDbId })`
- `clickGenerate()`
- `submitForm({ title, description })`
- `clickBack()` (from form → idle, or from preview → form)
- `clickSaveNote()`
- `clickDiscard()`
- `clickRetry({ kind: 'generate' | 'sync' })`
- `clickDuplicateChoice({ choice: 'append' | 'replace' | 'cancel' })`
- `clickRetryDraft()`
- `clickDiscardDraft()`
- `openSettings()` (gear icon)

### `DraftStore.ts` (new)

Persistent storage for the single in-flight draft. Uses `vscode.ExtensionContext.globalState`.

**Public API:**
```typescript
interface DraftData {
  title: string;
  description?: string;
  generatedNote: StructuredNote;  // from LLMService
  structuredContent?: string;      // from LLMService.structureForNotion (cached)
  lastError: string;
  createdAt: number;               // unix timestamp
  branchName: string;
}

class DraftStore {
  constructor(private context: vscode.ExtensionContext);

  get(): DraftData | null;
  save(draft: DraftData): Promise<void>;
  clear(): Promise<void>;
  exists(): boolean;
}
```

**Storage key:** `devnote.draft` in `globalState`.

### `webview/sidebar.html`, `sidebar.css`, `sidebar.js`

A single self-contained webview that renders all 11 states. Uses VS Code theme variables (`var(--vscode-editor-background)`, etc.) for native theming. Fluid responsive layout — works at any sidebar width.

State management is purely message-driven: the webview renders whatever state the extension tells it to. No business logic in the webview.

### `extension.ts` changes

```typescript
export function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigService(context.secrets);
  const provider = new SidebarProvider(context.extensionUri, context, configService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, provider)
  );

  // Single remaining command: opens the sidebar AND auto-triggers generate
  context.subscriptions.push(
    vscode.commands.registerCommand('devnote.create', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devnote-sidebar');
      await provider.triggerGenerate();
    })
  );
}
```

### `package.json` changes

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "devnote-sidebar",
          "title": "DevNote",
          "icon": "asset/icon.png"
        }
      ]
    },
    "views": {
      "devnote-sidebar": [
        {
          "type": "webview",
          "id": "devnote.sidebar",
          "name": "DevNote",
          "icon": "asset/icon.png"
        }
      ]
    },
    "commands": [
      {
        "command": "devnote.create",
        "title": "DevNote: Create Dev Note"
      }
    ],
    "keybindings": [
      {
        "command": "devnote.create",
        "key": "ctrl+alt+d",
        "when": "editorTextFocus"
      }
    ],
    "configuration": {
      "title": "DevNote",
      "properties": {
        "devnote.notionDatabaseId": {
          "type": "string",
          "default": "",
          "description": "Notion database ID to sync dev notes to"
        }
      }
    }
  }
}
```

**Removed:**
- `devnote.sync` command
- `devnote.setGeminiKey` command
- `devnote.setNotionToken` command
- `Ctrl+Alt+M` keybinding
- All references to `UIService`, `NoteService`, `webview/preview.html`

**Kept:**
- `devnote.create` command + `Ctrl+Alt+D` keybinding (now triggers sidebar + auto-generate)
- `devnote.notionDatabaseId` setting

---

## Visual Design

The visual design uses VS Code's native theme variables wherever possible to feel like part of the editor. Brand accents use the colors from the icon (electric blue + navy).

**Key principles:**
- Fluid responsive layout — works at any sidebar width
- VS Code theme tokens for backgrounds, borders, text colors
- Brand colors only for accents (loading animation, primary buttons)
- Standard VS Code button styles with custom variant for primary actions
- 8px spacing grid
- Sans-serif system font (matches VS Code default)

**Brand loader:**
A pulsing neural-circuit animation matching the brain icon. SVG-based for crispness at any size. Used in States 4 (Generating) and 7 (Syncing).

**Detailed CSS, color values, and animation specs are intentionally NOT in this spec.** They will be decided during implementation based on what feels right inside the actual VS Code chrome. The spec defines structure and behavior; visual polish is a separate concern.

---

## Error Handling

Every error in DevNote follows the same pattern:

1. **Catch the error** in the SidebarProvider
2. **Show a short, friendly message** in the sidebar (no technical details by default)
3. **Provide a retry path** via a button in the same sidebar state
4. **Preserve user data** so the retry can succeed without re-entering anything
5. **Save unsynced notes as drafts** via `DraftStore` for recovery across sessions

### Error message reference

| Failure point | Message text | Retry button | Draft saved? |
|---|---|---|---|
| Setup save failed (rare) | "Couldn't save your settings. Please try again." | Yes (re-save) | N/A |
| Git not available | "Not a git repository." | No (button disabled) | N/A |
| No changes | "No changes to document yet." | No (button disabled) | N/A |
| On main with no changes | "You're on main — nothing to document." | No (button disabled) | N/A |
| Gemini generation failed | "Couldn't generate note. Please try again." | Yes (re-generate) | No |
| Notion structuring failed | "Couldn't prepare note for Notion. Please try again." | Yes (re-sync) | Yes |
| Notion duplicate check failed | "Couldn't check Notion for duplicates. Please try again." | Yes (re-sync) | Yes |
| Notion create failed | "Couldn't sync to Notion. Please try again." | Yes (re-sync) | Yes |
| Notion append failed | "Couldn't add to existing Notion page. Please try again." | Yes (re-sync) | Yes |
| Notion replace failed | "Couldn't replace Notion page content. Please try again." | Yes (re-sync) | Yes |

### Settings access during errors

If the failure suggests a token problem, the error state also shows a contextual link: "Wrong token? [Update settings →]" — clicking opens the settings (State 1) inline.

---

## Cancellation & State Reset

When the user closes the DevNote sidebar mid-flow (during generation or syncing):

1. The `SidebarProvider` listens for the webview's `onDidDispose` event
2. Any in-flight `LLMService` or `NotionService` call is aborted via `AbortController`
3. In-memory generation state (title, description, generated note) is wiped
4. **Exception**: If the cancellation happens during sync (i.e., the note was already generated), the note is saved as a draft via `DraftStore` before wiping memory state

This gives a clean "cancel everything" behavior in most cases, while preserving expensive AI work that already completed.

---

## Backwards Compatibility

This release is a **breaking UX change**. Existing users will notice:

- The `Ctrl+Alt+M` shortcut no longer works
- Three command palette entries are gone
- The preview is no longer in a separate editor tab — it's in the sidebar
- The `custom_memory_note.md` file in the workspace root will not be created anymore

**Migration for existing users:**
- If a user has a leftover `custom_memory_note.md` from v0.1.x, the sidebar will detect it on first open and offer to migrate it as a draft via the recovery banner. After migration, the file is deleted.
- All existing settings (Gemini API key, Notion token, Notion database ID) are preserved — they live in SecretStorage and VS Code settings, not in any deprecated location.

This migration is **one-time only** and only handles the file → draft conversion. After the user retries or discards the migrated draft, the migration logic is never invoked again.

---

## Testing

Manual E2E testing only. No automated tests for this enhancement.

### Test scenarios

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | Fresh install, open sidebar | State 1 (setup form) shows |
| 2 | Save 3 valid tokens | State 2 (idle) shows after save |
| 3 | On feature branch with changes, click Generate Doc | State 3 (form) shows |
| 4 | Submit title + description | State 4 (generating) → State 5 (preview) |
| 5 | Click Save Note (no duplicate) | State 7 (stepped loader) → State 9 (success) → State 2 |
| 6 | Click Save Note (duplicate exists) | State 7 → State 8 (duplicate prompt) → user picks Append/Replace → State 7 → State 9 |
| 7 | Click Cancel in duplicate prompt | State 11 (draft banner) shows |
| 8 | Click Retry in draft banner | State 7 → State 9 (or State 10 if it fails again) |
| 9 | Click Discard in draft banner | State 2 (idle), draft removed |
| 10 | Click Back in preview | State 3 (form) with title/desc preserved |
| 11 | Click Discard in preview | State 2 (idle), generated note wiped |
| 12 | Switch to main (no changes), open sidebar | State 2 with disabled Generate Doc + reason |
| 13 | Generate Doc, then close sidebar mid-generation | API call aborted, State 2 on reopen, no draft |
| 14 | Generate succeeds, click Save Note, close sidebar mid-sync | Draft saved, State 11 on reopen |
| 15 | Press Ctrl+Alt+D shortcut | Sidebar opens AND State 4 (generating) starts immediately |
| 16 | Click gear icon | Opens State 1 with current values pre-filled |
| 17 | Generation fails (invalid Gemini key) | State 6 with friendly error + Retry |
| 18 | Sync fails (invalid Notion token) | State 10 with friendly error + Retry, draft saved |
| 19 | Existing user upgrades from v0.1.x with leftover `custom_memory_note.md` | State 11 (draft banner) shows on first open with migrated content |
| 20 | Sidebar resized to 200px width | Layout still readable, no horizontal scroll |
| 21 | Sidebar resized to 600px width | Layout doesn't look stretched/awkward |

---

## Open Questions (None at this time)

All design decisions have been resolved during the casual brainstorming session. The 12 doubts raised during that session are all answered and reflected in this spec.

---

## What's NOT in this spec

- Visual design system (colors, exact typography, animation curves) — decided during implementation
- Note history / past notes browsing — Phase 2 paid feature
- SQLite memory index — Phase 2 paid feature
- Context injection from past notes — Phase 2 paid feature
- TreeView sidebar — replaced entirely by webview-based sidebar in this design
- Branch change live detection — deferred for simplicity
- API key validation at save time — keys saved as-is
- Multiple concurrent drafts — only one draft at a time
- VS Code Marketplace publishing — separate concern, not part of this spec
- Open VSX republish — happens after implementation as a follow-up

---

## Future-Proofing

- The webview HTML is structured so additional states can be added without restructuring (e.g., a "draft history" state for Phase 2)
- `DraftStore` can be extended to hold multiple drafts in Phase 2 by changing the storage key from a single object to an array
- The `SidebarProvider`'s message contract is versioned-friendly — new message types can be added without breaking existing ones
- All backend services (`GitService`, `LLMService`, `NotionService`) keep their current interfaces — Phase 2 features (memory layer, context injection) can plug in via new service additions, not modifications
- The brand loader is a separate SVG asset — easy to swap or animate further as the brand evolves
