# DevNote Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DevNote's command-driven UX with a persistent sidebar panel that handles setup, generation, preview, sync, and error recovery — all in one place with real-time progress feedback.

**Architecture:** Add a new `SidebarProvider` (VS Code `WebviewViewProvider`) and a single webview HTML/CSS/JS bundle that renders 11 distinct UI states. The provider orchestrates the existing backend services (`GitService`, `LLMService`, `NotionService`, `ConfigService`). A new `DraftStore` persists in-flight notes across sessions using `globalState`. Old files (`UIService`, `NoteService`, `CommandHandler`, `webview/preview.html`) get removed in the final cleanup task.

**Tech Stack:** TypeScript 5, VS Code Webview API (`registerWebviewViewProvider`), VS Code `globalState` for draft persistence, native `fetch` for Notion, `@google/generative-ai`, `simple-git`. Webview uses vanilla HTML/CSS/JS (no React).

**Execution Mode:** Subagent-Driven Development.

---

## Implementation Strategy

The codebase is **rebuilt incrementally alongside the existing code**. For Tasks 1-12, the project compiles and works in "dual mode" — old commands still function while the new sidebar is built up. Tasks 13-14 do the switch-over and cleanup. Task 15 is manual testing.

This means at every checkpoint the project is in a runnable state and can be tested.

---

## File Map

### New files (created during this plan)

| File | Responsibility |
|---|---|
| `src/DraftStore.ts` | Persistent draft storage via `vscode.ExtensionContext.globalState` |
| `src/SidebarProvider.ts` | Webview view provider; orchestrates all sidebar states and backend services |
| `webview/sidebar.html` | Single HTML file with all 11 state DOM templates |
| `webview/sidebar.css` | Styles for all states; uses VS Code theme tokens |
| `webview/sidebar.js` | Webview JavaScript; state machine + message passing |

### Modified files

| File | Changes |
|---|---|
| `package.json` | Add `viewsContainers`, `views` contributions. Bump version to `0.2.0`. Remove 3 commands, 1 keybinding (in cleanup task). |
| `src/extension.ts` | Register `SidebarProvider`. Replace 4 command registrations with 1. (in cleanup task) |
| `CHANGELOG.md` | Add `0.2.0` entry (in cleanup task) |

### Deleted files (in cleanup task)

| File | Why removed |
|---|---|
| `src/UIService.ts` | Replaced by sidebar webview |
| `src/NoteService.ts` | No more local file safety net — drafts live in `globalState` |
| `src/CommandHandler.ts` | Replaced by `SidebarProvider` orchestration |
| `webview/preview.html` | Replaced by `webview/sidebar.html` |

### Files unchanged

- `src/GitService.ts` — used by SidebarProvider exactly as today
- `src/LLMService.ts` — used by SidebarProvider exactly as today
- `src/NotionService.ts` — used by SidebarProvider exactly as today
- `src/ConfigService.ts` — used by SidebarProvider exactly as today
- `tsconfig.json`, `.gitignore`, `LICENSE`, `README.md` (README will be updated separately if needed)

---

## Task 1: Create `DraftStore.ts` for draft persistence

**Files:**
- Create: `src/DraftStore.ts`

**Why this first:** `DraftStore` is a pure data layer with no dependencies on anything else. It can be created and reasoned about in isolation. Later tasks (especially Task 8 sync flow and Task 10 draft recovery) depend on it.

- [ ] **Step 1: Create `src/DraftStore.ts`**

```typescript
import * as vscode from 'vscode';
import { StructuredNote } from './LLMService';

export interface DraftData {
  title: string;
  description?: string;
  generatedNote: StructuredNote;
  structuredContent?: string;
  lastError: string;
  createdAt: number;
  branchName: string;
}

const STORAGE_KEY = 'devnote.draft';

export class DraftStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get(): DraftData | null {
    const raw = this.context.globalState.get<DraftData>(STORAGE_KEY);
    return raw ?? null;
  }

  exists(): boolean {
    return this.get() !== null;
  }

  async save(draft: DraftData): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, draft);
  }

  async clear(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, undefined);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/DraftStore.ts
git commit -m "feat: add DraftStore for persistent draft recovery"
```

---

## Task 2: Update `package.json` with sidebar view contributions (additive)

**Files:**
- Modify: `package.json`

**Why this second:** Declaring the views container and view in `package.json` makes VS Code show the activity bar icon on the next reload. We do this BEFORE writing the provider so we can verify the icon appears, and the view is empty until we register a provider in Task 4. All existing commands are preserved unchanged.

- [ ] **Step 1: Add `viewsContainers` and `views` contributions to `package.json`**

In the `contributes` section of `package.json` (currently starting at line 37), ADD the following two new keys at the top of `contributes` (above `commands`):

```json
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
```

The full `contributes` block should look like this after the change:

```json
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
      },
      {
        "command": "devnote.sync",
        "title": "DevNote: Sync to Notion"
      },
      {
        "command": "devnote.setGeminiKey",
        "title": "DevNote: Set Gemini API Key"
      },
      {
        "command": "devnote.setNotionToken",
        "title": "DevNote: Set Notion Token"
      }
    ],
    "keybindings": [...same as before...],
    "configuration": {...same as before...}
  }
```

**Important:** Do NOT change `commands`, `keybindings`, or `configuration` in this task. They stay exactly as they are.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add sidebar view container to package.json"
```

---

## Task 3: Create webview shell — HTML, CSS, JS

**Files:**
- Create: `webview/sidebar.html`
- Create: `webview/sidebar.css`
- Create: `webview/sidebar.js`

**Why these together:** HTML, CSS, and JS for the sidebar are tightly coupled. Splitting them across tasks would create awkward intermediate states (HTML without styles, JS attaching to nonexistent DOM nodes). This task creates the static skeleton with all 11 state templates. No connection to extension yet — that comes in Task 4.

- [ ] **Step 1: Create `webview/sidebar.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src 'nonce-{{NONCE}}'; style-src vscode-resource: 'unsafe-inline'; font-src vscode-resource:;">
  <link rel="stylesheet" href="{{CSS_URI}}">
  <title>DevNote</title>
</head>
<body>
  <div class="header">
    <div class="brand">
      <span class="brand-icon">🧠</span>
      <span class="brand-name">DevNote</span>
    </div>
    <button class="gear-button" id="gear-button" title="Settings" aria-label="Settings">⚙️</button>
  </div>

  <main class="content">
    <!-- State 1: Setup -->
    <section class="state" data-state="setup" hidden>
      <h2>Setup DevNote before using:</h2>

      <label for="gemini-key">Gemini API Key</label>
      <input type="password" id="gemini-key" placeholder="Paste your Gemini API key" />
      <a class="helper-link" href="https://aistudio.google.com/apikey" target="_blank">Get your free key →</a>

      <label for="notion-token">Notion Integration Token</label>
      <input type="password" id="notion-token" placeholder="Paste your Notion token" />
      <a class="helper-link" href="https://www.notion.so/my-integrations" target="_blank">How to create one →</a>

      <label for="notion-db">Notion Database ID</label>
      <input type="text" id="notion-db" placeholder="32-character database ID" />
      <a class="helper-link" href="https://developers.notion.com/docs/working-with-databases#adding-pages-to-a-database" target="_blank">How to find it →</a>

      <p class="error-message" id="setup-error" hidden></p>

      <button class="primary-button" id="save-setup">Save</button>
    </section>

    <!-- State 11: Draft Recovery Banner (above all other states) -->
    <section class="draft-banner" id="draft-banner" hidden>
      <div class="warning-icon">⚠️</div>
      <div class="draft-content">
        <p class="draft-title">Unsynced draft from <span id="draft-time"></span></p>
        <p class="draft-note-title">Title: <span id="draft-note-title"></span></p>
        <p class="draft-error">Last error: <span id="draft-error"></span></p>
        <div class="draft-actions">
          <button class="primary-button small" id="draft-retry">🔁 Retry Sync</button>
          <button class="secondary-button small" id="draft-discard">🗑 Discard</button>
        </div>
      </div>
    </section>

    <!-- State 2: Idle -->
    <section class="state" data-state="idle" hidden>
      <p class="branch-indicator">📍 <span id="branch-name">—</span></p>
      <button class="primary-button" id="generate-button">Generate Doc</button>
      <p class="disabled-reason" id="disabled-reason" hidden></p>
    </section>

    <!-- State 3: Form -->
    <section class="state" data-state="form" hidden>
      <p class="branch-indicator">📍 <span id="form-branch-name">—</span></p>

      <label for="form-title">Title (required)</label>
      <input type="text" id="form-title" placeholder="What did you work on?" />

      <label for="form-description">Description (optional)</label>
      <textarea id="form-description" rows="3" placeholder="Context, decisions, things to remember..."></textarea>

      <div class="row">
        <button class="secondary-button" id="form-back">← Back</button>
        <button class="primary-button" id="form-submit" disabled>Generate</button>
      </div>
    </section>

    <!-- State 4: Generating -->
    <section class="state" data-state="generating" hidden>
      <div class="loader-container">
        <div class="brand-loader"></div>
        <p class="loader-text" id="generating-text">Generating note with Gemini...</p>
      </div>
    </section>

    <!-- State 5: Preview -->
    <section class="state" data-state="preview" hidden>
      <button class="back-link" id="preview-back">← Back</button>

      <h3 class="preview-title" id="preview-title">—</h3>
      <hr />

      <h4>Summary</h4>
      <p id="preview-summary">—</p>

      <h4>What Changed</h4>
      <ul id="preview-what-changed"></ul>

      <h4>Why</h4>
      <p id="preview-why">—</p>

      <h4>Key Decisions</h4>
      <p id="preview-key-decisions">—</p>

      <h4>Files Affected</h4>
      <ul id="preview-files-affected"></ul>

      <div class="row">
        <button class="primary-button" id="preview-save">Save Note</button>
        <button class="secondary-button" id="preview-discard">Discard</button>
      </div>
    </section>

    <!-- State 6: Generation Error -->
    <section class="state" data-state="generate-error" hidden>
      <p class="branch-indicator">📍 <span id="gen-error-branch-name">—</span></p>
      <button class="primary-button" id="gen-error-generate">Generate Doc</button>
      <p class="error-message">❌ <span id="gen-error-message">Couldn't generate note. Please try again.</span></p>
      <button class="primary-button retry-button" id="gen-error-retry">🔁 Retry</button>
    </section>

    <!-- State 7: Syncing -->
    <section class="state" data-state="syncing" hidden>
      <div class="loader-container">
        <div class="brand-loader"></div>
        <p class="loader-text" id="syncing-text">Preparing note...</p>
      </div>
    </section>

    <!-- State 8: Duplicate Detected -->
    <section class="state" data-state="duplicate" hidden>
      <div class="warning-icon">⚠️</div>
      <p>A note titled "<span id="duplicate-title">—</span>" already exists in your Notion database.</p>
      <p>What do you want to do?</p>

      <button class="choice-button" id="dup-append">
        <strong>➕ Append</strong>
        <span class="choice-detail">Add new content below the existing page</span>
      </button>

      <button class="choice-button" id="dup-replace">
        <strong>🔄 Replace</strong>
        <span class="choice-detail">Delete old content, use new content (same page URL preserved)</span>
      </button>

      <button class="choice-button" id="dup-cancel">
        <strong>✕ Cancel</strong>
        <span class="choice-detail">Keep the draft and decide later</span>
      </button>
    </section>

    <!-- State 9: Sync Success -->
    <section class="state" data-state="success" hidden>
      <p class="success-message">✅ <span id="success-text">You got it! Note synced to Notion.</span></p>
    </section>

    <!-- State 10: Sync Error -->
    <section class="state" data-state="sync-error" hidden>
      <p class="branch-indicator">📍 <span id="sync-error-branch-name">—</span></p>
      <button class="primary-button" id="sync-error-generate">Generate Doc</button>
      <p class="error-message">❌ <span id="sync-error-message">Couldn't sync to Notion. Please try again.</span></p>
      <button class="primary-button retry-button" id="sync-error-retry">🔁 Retry</button>
    </section>
  </main>

  <script nonce="{{NONCE}}" src="{{JS_URI}}"></script>
</body>
</html>
```

- [ ] **Step 2: Create `webview/sidebar.css`**

```css
:root {
  --brand-blue: #3B82F6;
  --brand-navy: #0F172A;
  --spacing: 12px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background-color: var(--vscode-sideBar-background);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing);
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.brand-icon {
  font-size: 18px;
}

.brand-name {
  font-size: 14px;
}

.gear-button {
  background: none;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
}

.gear-button:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.content {
  padding: var(--spacing);
}

.state {
  display: flex;
  flex-direction: column;
  gap: var(--spacing);
}

.state[hidden] {
  display: none;
}

label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}

input, textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--vscode-input-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border-radius: 4px;
  font-family: inherit;
  font-size: var(--vscode-font-size);
}

input:focus, textarea:focus {
  outline: 1px solid var(--brand-blue);
  outline-offset: -1px;
}

textarea {
  resize: vertical;
  min-height: 60px;
}

.helper-link {
  display: block;
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
  margin-top: 2px;
  margin-bottom: var(--spacing);
}

.helper-link:hover {
  text-decoration: underline;
}

.primary-button {
  padding: 10px 16px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
}

.primary-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-button {
  padding: 10px 16px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}

.secondary-button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.small {
  padding: 6px 10px;
  font-size: 12px;
}

.row {
  display: flex;
  gap: 8px;
}

.row .primary-button, .row .secondary-button {
  flex: 1;
}

.branch-indicator {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}

.disabled-reason {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin: 4px 0 0 0;
}

.error-message {
  color: var(--vscode-errorForeground);
  font-size: 12px;
  margin: 0;
}

.success-message {
  color: var(--vscode-testing-iconPassed);
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  padding: var(--spacing);
}

.retry-button {
  align-self: flex-start;
}

.back-link {
  background: none;
  border: none;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  padding: 0;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.preview-title {
  margin: 0;
  font-size: 16px;
}

h4 {
  margin: 8px 0 4px 0;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--brand-blue);
  letter-spacing: 0.5px;
}

ul {
  margin: 0;
  padding-left: 20px;
}

hr {
  border: none;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
  margin: 4px 0;
}

.draft-banner {
  display: flex;
  gap: 8px;
  padding: var(--spacing);
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 4px;
  margin-bottom: var(--spacing);
}

.draft-banner[hidden] {
  display: none;
}

.warning-icon {
  font-size: 18px;
}

.draft-content {
  flex: 1;
}

.draft-title, .draft-note-title, .draft-error {
  margin: 0 0 4px 0;
  font-size: 12px;
}

.draft-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.choice-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: var(--spacing);
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  gap: 4px;
}

.choice-button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
  border-color: var(--brand-blue);
}

.choice-detail {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.loader-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing);
  padding: 32px var(--spacing);
}

.loader-text {
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
  text-align: center;
}

.brand-loader {
  width: 48px;
  height: 48px;
  border: 3px solid var(--vscode-sideBarSectionHeader-border);
  border-top-color: var(--brand-blue);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Create `webview/sidebar.js`**

```javascript
// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  const STATES = {
    SETUP: 'setup',
    IDLE: 'idle',
    FORM: 'form',
    GENERATING: 'generating',
    PREVIEW: 'preview',
    GENERATE_ERROR: 'generate-error',
    SYNCING: 'syncing',
    DUPLICATE: 'duplicate',
    SUCCESS: 'success',
    SYNC_ERROR: 'sync-error',
  };

  function showState(name) {
    document.querySelectorAll('.state').forEach((el) => {
      el.hidden = el.getAttribute('data-state') !== name;
    });
  }

  function setBranchInfo(branch, canGenerate, reason) {
    const branchEls = document.querySelectorAll('#branch-name, #form-branch-name, #gen-error-branch-name, #sync-error-branch-name');
    branchEls.forEach((el) => { el.textContent = branch || '—'; });

    const generateBtn = document.getElementById('generate-button');
    const reasonEl = document.getElementById('disabled-reason');
    if (generateBtn) {
      generateBtn.disabled = !canGenerate;
    }
    if (reasonEl) {
      if (canGenerate) {
        reasonEl.hidden = true;
      } else {
        reasonEl.textContent = reason || '';
        reasonEl.hidden = false;
      }
    }
  }

  function setLoadingText(text) {
    const generatingText = document.getElementById('generating-text');
    const syncingText = document.getElementById('syncing-text');
    if (generatingText) generatingText.textContent = text;
    if (syncingText) syncingText.textContent = text;
  }

  function setPreview(note) {
    document.getElementById('preview-title').textContent = note.title || '—';
    document.getElementById('preview-summary').textContent = note.summary || '—';
    document.getElementById('preview-why').textContent = note.why || '—';
    document.getElementById('preview-key-decisions').textContent = note.keyDecisions || '—';

    const whatChangedList = document.getElementById('preview-what-changed');
    whatChangedList.innerHTML = '';
    (note.whatChanged || []).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      whatChangedList.appendChild(li);
    });

    const filesList = document.getElementById('preview-files-affected');
    filesList.innerHTML = '';
    (note.filesAffected || []).forEach((file) => {
      const li = document.createElement('li');
      li.textContent = file;
      filesList.appendChild(li);
    });
  }

  function setDraftBanner(draft) {
    const banner = document.getElementById('draft-banner');
    if (!draft) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    document.getElementById('draft-time').textContent = formatTime(draft.createdAt);
    document.getElementById('draft-note-title').textContent = draft.title;
    document.getElementById('draft-error').textContent = draft.lastError;
  }

  function formatTime(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  // Setup state listeners
  document.getElementById('save-setup').addEventListener('click', () => {
    const geminiKey = document.getElementById('gemini-key').value.trim();
    const notionToken = document.getElementById('notion-token').value.trim();
    const notionDbId = document.getElementById('notion-db').value.trim();

    if (!geminiKey || !notionToken || !notionDbId) {
      const errEl = document.getElementById('setup-error');
      errEl.textContent = 'Please fill in all 3 fields.';
      errEl.hidden = false;
      return;
    }

    vscode.postMessage({ type: 'saveSetup', geminiKey, notionToken, notionDbId });
  });

  // Idle state listeners
  document.getElementById('generate-button').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickGenerate' });
  });

  // Form state listeners
  const formTitle = document.getElementById('form-title');
  const formSubmit = document.getElementById('form-submit');
  formTitle.addEventListener('input', () => {
    formSubmit.disabled = formTitle.value.trim().length === 0;
  });

  document.getElementById('form-back').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickBack', from: 'form' });
  });

  formSubmit.addEventListener('click', () => {
    vscode.postMessage({
      type: 'submitForm',
      title: formTitle.value.trim(),
      description: document.getElementById('form-description').value.trim() || undefined,
    });
  });

  // Preview state listeners
  document.getElementById('preview-back').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickBack', from: 'preview' });
  });

  document.getElementById('preview-save').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickSaveNote' });
  });

  document.getElementById('preview-discard').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDiscard' });
  });

  // Error state listeners
  document.getElementById('gen-error-retry').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickRetry', kind: 'generate' });
  });

  document.getElementById('sync-error-retry').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickRetry', kind: 'sync' });
  });

  // Duplicate choice listeners
  document.getElementById('dup-append').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDuplicateChoice', choice: 'append' });
  });

  document.getElementById('dup-replace').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDuplicateChoice', choice: 'replace' });
  });

  document.getElementById('dup-cancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDuplicateChoice', choice: 'cancel' });
  });

  // Draft recovery listeners
  document.getElementById('draft-retry').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickRetryDraft' });
  });

  document.getElementById('draft-discard').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDiscardDraft' });
  });

  // Gear icon
  document.getElementById('gear-button').addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

  // Listen for messages from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'setState':
        showState(msg.state);
        if (msg.state === STATES.PREVIEW && msg.data?.note) {
          setPreview(msg.data.note);
        }
        if (msg.state === STATES.DUPLICATE && msg.data?.title) {
          document.getElementById('duplicate-title').textContent = msg.data.title;
        }
        if (msg.state === STATES.GENERATE_ERROR && msg.data?.message) {
          document.getElementById('gen-error-message').textContent = msg.data.message;
        }
        if (msg.state === STATES.SYNC_ERROR && msg.data?.message) {
          document.getElementById('sync-error-message').textContent = msg.data.message;
        }
        if (msg.state === STATES.SUCCESS && msg.data?.message) {
          document.getElementById('success-text').textContent = msg.data.message;
        }
        break;
      case 'setBranchInfo':
        setBranchInfo(msg.branch, msg.canGenerate, msg.reason);
        break;
      case 'setLoadingText':
        setLoadingText(msg.text);
        break;
      case 'setDraft':
        setDraftBanner(msg.draft);
        break;
      case 'restoreForm':
        if (msg.title) document.getElementById('form-title').value = msg.title;
        if (msg.description) document.getElementById('form-description').value = msg.description;
        formSubmit.disabled = !msg.title;
        break;
      case 'prefillSetup':
        document.getElementById('gemini-key').value = msg.geminiKey || '';
        document.getElementById('notion-token').value = msg.notionToken || '';
        document.getElementById('notion-db').value = msg.notionDbId || '';
        break;
    }
  });

  // Tell extension we're ready
  vscode.postMessage({ type: 'ready' });
})();
```

- [ ] **Step 4: Verify TypeScript still compiles (HTML/CSS/JS don't need compilation but check the project)**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add webview/sidebar.html webview/sidebar.css webview/sidebar.js
git commit -m "feat: add webview shell with all 11 sidebar states"
```

---

## Task 4: Create `SidebarProvider.ts` skeleton and register in `extension.ts`

**Files:**
- Create: `src/SidebarProvider.ts`
- Modify: `src/extension.ts`

**Why now:** With the manifest declaring the view (Task 2) and the webview assets ready (Task 3), we can now create the provider that ties them together. This task creates a SKELETON provider — it loads the HTML and shows the initial state but doesn't yet handle any user actions or implement business logic. That comes in Tasks 5-12.

After this task, clicking the DevNote icon in the activity bar shows the sidebar with whatever the initial state is. Old commands still work in parallel.

- [ ] **Step 1: Create `src/SidebarProvider.ts` skeleton**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ConfigService } from './ConfigService';
import { DraftStore } from './DraftStore';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devnote.sidebar';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly configService: ConfigService,
    private readonly draftStore: DraftStore
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'asset'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') {
        this.handleReady();
      }
    });
  }

  // External trigger from Ctrl+Alt+D shortcut — to be implemented in Task 13
  async triggerGenerate(): Promise<void> {
    // Implementation comes in Task 13
  }

  private async handleReady(): Promise<void> {
    // Initial state decision: setup or idle?
    const geminiKey = await this.configService.getGeminiApiKey();
    const notionToken = await this.configService.getNotionToken();
    const notionDbId = this.configService.getNotionDatabaseId();

    if (!geminiKey || !notionToken || !notionDbId) {
      this.postMessage({ type: 'setState', state: 'setup' });
    } else {
      this.postMessage({ type: 'setState', state: 'idle' });
    }
  }

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'webview', 'sidebar.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'sidebar.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'sidebar.js')
    );
    const nonce = this.generateNonce();

    return html
      .replace(/\{\{CSS_URI\}\}/g, cssUri.toString())
      .replace(/\{\{JS_URI\}\}/g, jsUri.toString())
      .replace(/\{\{NONCE\}\}/g, nonce);
  }

  private generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}
```

- [ ] **Step 2: Update `src/extension.ts` to register the SidebarProvider (alongside existing commands)**

Find the existing `activate` function. Add the SidebarProvider registration WITHOUT removing any existing command registrations. Replace the `activate` function with this:

```typescript
import * as vscode from 'vscode';
import { CommandHandler } from './CommandHandler';
import { ConfigService } from './ConfigService';
import { UIService } from './UIService';
import { SidebarProvider } from './SidebarProvider';
import { DraftStore } from './DraftStore';

export function activate(context: vscode.ExtensionContext) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const configService = new ConfigService(context.secrets);
  const draftStore = new DraftStore(context);

  // Register the new sidebar provider (works without a workspace)
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context,
    configService,
    draftStore
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Old command-based flow — kept temporarily during the transition
  if (!workspacePath) {
    return;
  }

  const uiService = new UIService(context.extensionPath);
  const handler = new CommandHandler(configService, uiService, workspacePath);

  const createCommand = vscode.commands.registerCommand('devnote.create', async () => {
    try {
      await handler.handleCreate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DevNote: ${msg}`);
    }
  });

  const syncCommand = vscode.commands.registerCommand('devnote.sync', async () => {
    try {
      await handler.handleSync();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DevNote: ${msg}`);
    }
  });

  const setGeminiKeyCommand = vscode.commands.registerCommand(
    'devnote.setGeminiKey',
    async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Gemini API key',
        placeHolder: 'Paste your API key here',
        password: true,
      });
      if (!key) return;
      await configService.setGeminiApiKey(key);
      vscode.window.showInformationMessage('DevNote: Gemini API key saved.');
    }
  );

  const setNotionTokenCommand = vscode.commands.registerCommand(
    'devnote.setNotionToken',
    async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Notion integration token',
        placeHolder: 'Paste your Notion token here',
        password: true,
      });
      if (!token) return;
      await configService.setNotionToken(token);
      vscode.window.showInformationMessage('DevNote: Notion token saved.');
    }
  );

  context.subscriptions.push(
    createCommand,
    syncCommand,
    setGeminiKeyCommand,
    setNotionTokenCommand
  );
}

export function deactivate() {}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/SidebarProvider.ts src/extension.ts
git commit -m "feat: register sidebar provider alongside existing commands"
```

---

## Task 5: Implement State 1 (Setup) — full save flow

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** Wires up the setup form. When the user fills in 3 fields and clicks Save, the values are stored via `ConfigService` and the sidebar transitions to State 2 (Idle).

- [ ] **Step 1: Add setup save handler to `SidebarProvider.ts`**

In `src/SidebarProvider.ts`, find the `onDidReceiveMessage` block in `resolveWebviewView`. Replace it with this expanded version that handles `saveSetup`:

```typescript
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            await this.handleReady();
            break;
          case 'saveSetup':
            await this.handleSaveSetup(msg.geminiKey, msg.notionToken, msg.notionDbId);
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`DevNote: ${message}`);
      }
    });
```

Then ADD this new private method to the class:

```typescript
  private async handleSaveSetup(geminiKey: string, notionToken: string, notionDbId: string): Promise<void> {
    await this.configService.setGeminiApiKey(geminiKey);
    await this.configService.setNotionToken(notionToken);

    const config = vscode.workspace.getConfiguration('devnote');
    await config.update('notionDatabaseId', notionDbId, vscode.ConfigurationTarget.Global);

    this.postMessage({ type: 'setState', state: 'idle' });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: implement setup state save flow in SidebarProvider"
```

---

## Task 6: Implement States 2 & 3 (Idle and Form) with branch detection

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** Adds branch detection to the idle state and wires the Generate Doc button to transition to the form state. The form state has back navigation. Form data is preserved when going back.

- [ ] **Step 1: Add `GitService` import and form state handling to `SidebarProvider.ts`**

At the top of `src/SidebarProvider.ts`, add this import:

```typescript
import { GitService } from './GitService';
```

Then add a private field to the class to hold pending form state:

```typescript
  private pendingFormData: { title: string; description?: string } | null = null;
```

Add this method:

```typescript
  private getWorkspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async refreshIdleState(): Promise<void> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      this.postMessage({ type: 'setBranchInfo', branch: '—', canGenerate: false, reason: 'Not a git repository.' });
      this.postMessage({ type: 'setState', state: 'idle' });
      return;
    }

    const gitService = new GitService(workspacePath);
    try {
      const isRepo = (await gitService.checkAvailability()).available;
      if (!isRepo) {
        const reason = (await gitService.checkAvailability()).reason ?? 'Not a git repository.';
        const friendly =
          reason === 'Not a git repository' ? 'Not a git repository.' :
          reason === 'On base branch with no uncommitted changes' ? 'You\'re on main — nothing to document.' :
          'No changes to document yet.';
        const branchName = await this.tryGetBranchName(gitService);
        this.postMessage({ type: 'setBranchInfo', branch: branchName, canGenerate: false, reason: friendly });
        this.postMessage({ type: 'setState', state: 'idle' });
        return;
      }

      const branchName = await this.tryGetBranchName(gitService);
      this.postMessage({ type: 'setBranchInfo', branch: branchName, canGenerate: true });
      this.postMessage({ type: 'setState', state: 'idle' });
    } catch (err) {
      this.postMessage({ type: 'setBranchInfo', branch: '—', canGenerate: false, reason: 'Not a git repository.' });
      this.postMessage({ type: 'setState', state: 'idle' });
    }
  }

  private async tryGetBranchName(gitService: GitService): Promise<string> {
    try {
      const baseBranch = await gitService.getBaseBranch();
      // Use git directly to get the current branch — there's no explicit method on GitService,
      // but we can re-derive it. For simplicity, return the base branch label or '—'.
      const onBase = await gitService.isOnBaseBranch();
      if (onBase) return baseBranch;
      // For non-base branch, try a quick git call
      const branchDiff = await gitService.getBranchDiff();
      return `feature branch (${branchDiff.commitCount} commits)`;
    } catch {
      return '—';
    }
  }
```

**Important note about branch name:** The current `GitService` doesn't expose a public method to read the current branch name directly. The implementer should add a small helper to `GitService` if cleaner output is needed. For this task, the placeholder string above is acceptable. A cleaner approach is to add `async getCurrentBranch(): Promise<string>` to `GitService.ts` that calls `this.git.revparse(['--abbrev-ref', 'HEAD'])`. The implementer is encouraged to do this for nicer UX:

In `src/GitService.ts`, add this public method to the `GitService` class (right after `getBaseBranch`):

```typescript
  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  }
```

Then update `tryGetBranchName` in `SidebarProvider.ts` to use it:

```typescript
  private async tryGetBranchName(gitService: GitService): Promise<string> {
    try {
      return await gitService.getCurrentBranch();
    } catch {
      return '—';
    }
  }
```

- [ ] **Step 2: Update `handleReady` to use `refreshIdleState`**

Replace the existing `handleReady` method with:

```typescript
  private async handleReady(): Promise<void> {
    // Always refresh draft banner
    const draft = this.draftStore.get();
    this.postMessage({ type: 'setDraft', draft });

    const geminiKey = await this.configService.getGeminiApiKey();
    const notionToken = await this.configService.getNotionToken();
    const notionDbId = this.configService.getNotionDatabaseId();

    if (!geminiKey || !notionToken || !notionDbId) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    if (this.draftStore.exists()) {
      // When draft exists, idle state shows but Generate Doc is disabled
      this.postMessage({
        type: 'setBranchInfo',
        branch: '—',
        canGenerate: false,
        reason: 'Resolve the unsynced draft above before creating a new note.',
      });
      this.postMessage({ type: 'setState', state: 'idle' });
      return;
    }

    await this.refreshIdleState();
  }
```

- [ ] **Step 3: Add form state handling to `onDidReceiveMessage`**

In `resolveWebviewView`, expand the `onDidReceiveMessage` switch statement to handle the new message types:

```typescript
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            await this.handleReady();
            break;
          case 'saveSetup':
            await this.handleSaveSetup(msg.geminiKey, msg.notionToken, msg.notionDbId);
            break;
          case 'clickGenerate':
            await this.handleClickGenerate();
            break;
          case 'submitForm':
            await this.handleSubmitForm(msg.title, msg.description);
            break;
          case 'clickBack':
            await this.handleClickBack(msg.from);
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`DevNote: ${message}`);
      }
    });
```

Add these methods to the class:

```typescript
  private async handleClickGenerate(): Promise<void> {
    // Show form state, restoring any preserved data
    this.postMessage({ type: 'setState', state: 'form' });
    if (this.pendingFormData) {
      this.postMessage({
        type: 'restoreForm',
        title: this.pendingFormData.title,
        description: this.pendingFormData.description,
      });
    }
  }

  private async handleSubmitForm(title: string, description?: string): Promise<void> {
    this.pendingFormData = { title, description };
    // Generation flow — implemented in Task 7
    // For now, just go back to idle (placeholder)
    this.postMessage({ type: 'setState', state: 'generating' });
    this.postMessage({ type: 'setLoadingText', text: 'Generating note with Gemini...' });
  }

  private async handleClickBack(from: string): Promise<void> {
    if (from === 'form') {
      // Form → Idle. Preserve form data so user can come back.
      await this.refreshIdleState();
    } else if (from === 'preview') {
      // Preview → Form. Form data is already preserved.
      this.postMessage({ type: 'setState', state: 'form' });
      if (this.pendingFormData) {
        this.postMessage({
          type: 'restoreForm',
          title: this.pendingFormData.title,
          description: this.pendingFormData.description,
        });
      }
    }
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/SidebarProvider.ts src/GitService.ts
git commit -m "feat: implement idle and form states with branch detection"
```

---

## Task 7: Implement States 4, 5, 6 (Generation flow)

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** Wires the generation step. When the user submits the form, calls `LLMService.generateNote`, transitions to preview on success, or shows generation error state on failure. Includes AbortController for cancellation.

- [ ] **Step 1: Add generation logic to `SidebarProvider.ts`**

At the top of the file, add this import:

```typescript
import { GeminiLLMService, NotePayload, StructuredNote } from './LLMService';
```

Add private fields to the class:

```typescript
  private currentNote: StructuredNote | null = null;
  private generateAbortController: AbortController | null = null;
```

Replace the placeholder `handleSubmitForm` from Task 6 with this complete implementation:

```typescript
  private async handleSubmitForm(title: string, description?: string): Promise<void> {
    this.pendingFormData = { title, description };

    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      this.postMessage({ type: 'setState', state: 'generate-error', data: { message: 'Not a git repository.' } });
      return;
    }

    const apiKey = await this.configService.getGeminiApiKey();
    if (!apiKey) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    this.postMessage({ type: 'setState', state: 'generating' });
    this.postMessage({ type: 'setLoadingText', text: 'Generating note with Gemini...' });

    this.generateAbortController = new AbortController();

    try {
      const gitService = new GitService(workspacePath);
      const onBase = await gitService.isOnBaseBranch();

      let payload: NotePayload;
      if (onBase) {
        const uncommitted = await gitService.getUncommittedDiff();
        payload = {
          branchDiff: '',
          filesChanged: uncommitted.filesChanged,
          commitCount: 0,
          title,
          uncommittedStaged: uncommitted.staged,
          uncommittedUnstaged: uncommitted.unstaged,
          userNotes: description,
        };
      } else {
        const branchDiff = await gitService.getBranchDiff();
        payload = {
          branchDiff: branchDiff.branchDiff,
          filesChanged: branchDiff.filesChanged,
          commitCount: branchDiff.commitCount,
          title,
          userNotes: description,
        };

        const uncommitted = await gitService.getUncommittedDiff();
        if (uncommitted.staged || uncommitted.unstaged) {
          payload.uncommittedStaged = uncommitted.staged;
          payload.uncommittedUnstaged = uncommitted.unstaged;
          const allFiles = new Set([...payload.filesChanged, ...uncommitted.filesChanged]);
          payload.filesChanged = [...allFiles];
        }
      }

      const llmService = new GeminiLLMService(apiKey);
      const note = await llmService.generateNote(payload);

      // Check if cancelled while we were waiting
      if (this.generateAbortController?.signal.aborted) {
        return;
      }

      this.currentNote = note;
      this.postMessage({ type: 'setState', state: 'preview', data: { note } });
    } catch (err) {
      if (this.generateAbortController?.signal.aborted) {
        return;
      }
      this.postMessage({
        type: 'setState',
        state: 'generate-error',
        data: { message: 'Couldn\'t generate note. Please try again.' },
      });
    }
  }
```

- [ ] **Step 2: Add retry handler for generation errors**

In `onDidReceiveMessage`, add a new case for `clickRetry`:

```typescript
          case 'clickRetry':
            await this.handleClickRetry(msg.kind);
            break;
          case 'clickDiscard':
            await this.handleClickDiscard();
            break;
```

Add these methods to the class:

```typescript
  private async handleClickRetry(kind: 'generate' | 'sync'): Promise<void> {
    if (kind === 'generate' && this.pendingFormData) {
      await this.handleSubmitForm(this.pendingFormData.title, this.pendingFormData.description);
    }
    // 'sync' retry handled in Task 8
  }

  private async handleClickDiscard(): Promise<void> {
    this.currentNote = null;
    this.pendingFormData = null;
    await this.refreshIdleState();
  }
```

- [ ] **Step 3: Add cancellation on webview dispose**

In `resolveWebviewView`, after the `onDidReceiveMessage` block, add:

```typescript
    webviewView.onDidDispose(() => {
      if (this.generateAbortController) {
        this.generateAbortController.abort();
        this.generateAbortController = null;
      }
      this.currentNote = null;
      this.pendingFormData = null;
    });
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: implement generation flow with preview and error retry"
```

---

## Task 8: Implement States 7, 9, 10 (Sync flow happy path + error)

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** Wires Save Note → stepped sync loader → push to Notion → success or error. On error, the note is saved as a draft via DraftStore.

- [ ] **Step 1: Add sync logic to `SidebarProvider.ts`**

At the top of the file, add this import:

```typescript
import { NotionService } from './NotionService';
```

Add a private field for sync state:

```typescript
  private syncAbortController: AbortController | null = null;
```

Add the `clickSaveNote` case to `onDidReceiveMessage`:

```typescript
          case 'clickSaveNote':
            await this.handleClickSaveNote();
            break;
```

Add this method to the class:

```typescript
  private async handleClickSaveNote(): Promise<void> {
    if (!this.currentNote || !this.pendingFormData) {
      this.postMessage({
        type: 'setState',
        state: 'sync-error',
        data: { message: 'No note in memory to sync. Please regenerate.' },
      });
      return;
    }

    const notionToken = await this.configService.getNotionToken();
    if (!notionToken) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    const databaseId = this.configService.getNotionDatabaseId();
    if (!databaseId) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    const apiKey = await this.configService.getGeminiApiKey();
    if (!apiKey) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    this.postMessage({ type: 'setState', state: 'syncing' });
    this.postMessage({ type: 'setLoadingText', text: 'Preparing note...' });
    this.syncAbortController = new AbortController();

    try {
      const llmService = new GeminiLLMService(apiKey);

      // Step 1: Structure for Notion
      const noteContent = this.serializeNoteToMarkdown(this.currentNote);
      const structuredContent = await llmService.structureForNotion(noteContent);
      if (this.syncAbortController?.signal.aborted) return;

      // Step 2: Check for duplicate
      this.postMessage({ type: 'setLoadingText', text: 'Checking Notion...' });
      const notionService = new NotionService(notionToken, databaseId);
      const existingPageId = await notionService.findPageByTitle(this.pendingFormData.title);
      if (this.syncAbortController?.signal.aborted) return;

      if (existingPageId !== null) {
        // Duplicate — Task 9 will handle this
        this.postMessage({
          type: 'setState',
          state: 'duplicate',
          data: { title: this.pendingFormData.title },
        });
        return;
      }

      // Step 3: Push new page
      this.postMessage({ type: 'setLoadingText', text: 'Syncing to Notion...' });
      await notionService.push(this.pendingFormData.title, structuredContent);
      if (this.syncAbortController?.signal.aborted) return;

      // Success
      await this.draftStore.clear();
      this.postMessage({
        type: 'setState',
        state: 'success',
        data: { message: 'You got it! Note synced to Notion.' },
      });

      // Auto-transition to idle after 3 seconds
      setTimeout(() => {
        this.currentNote = null;
        this.pendingFormData = null;
        void this.refreshIdleState();
      }, 3000);
    } catch (err) {
      if (this.syncAbortController?.signal.aborted) return;
      await this.saveCurrentAsDraft('Couldn\'t sync to Notion. Please try again.');
      this.postMessage({
        type: 'setState',
        state: 'sync-error',
        data: { message: 'Couldn\'t sync to Notion. Please try again.' },
      });
    }
  }

  private async saveCurrentAsDraft(errorMessage: string): Promise<void> {
    if (!this.currentNote || !this.pendingFormData) return;

    const workspacePath = this.getWorkspacePath();
    let branchName = '—';
    if (workspacePath) {
      try {
        const gitService = new GitService(workspacePath);
        branchName = await gitService.getCurrentBranch();
      } catch {
        // ignore
      }
    }

    await this.draftStore.save({
      title: this.pendingFormData.title,
      description: this.pendingFormData.description,
      generatedNote: this.currentNote,
      lastError: errorMessage,
      createdAt: Date.now(),
      branchName,
    });
  }

  private serializeNoteToMarkdown(note: StructuredNote): string {
    return [
      `# ${note.title}`,
      ``,
      `## Summary`,
      note.summary,
      ``,
      `## What Changed`,
      ...note.whatChanged.map((c) => `- ${c}`),
      ``,
      `## Why`,
      note.why,
      ``,
      `## Key Decisions`,
      note.keyDecisions,
      ``,
      `## Files Affected`,
      ...note.filesAffected.map((f) => `- ${f}`),
    ].join('\n');
  }
```

- [ ] **Step 2: Update `handleClickRetry` to handle sync retries**

Replace `handleClickRetry` with:

```typescript
  private async handleClickRetry(kind: 'generate' | 'sync'): Promise<void> {
    if (kind === 'generate' && this.pendingFormData) {
      await this.handleSubmitForm(this.pendingFormData.title, this.pendingFormData.description);
    } else if (kind === 'sync') {
      await this.handleClickSaveNote();
    }
  }
```

- [ ] **Step 3: Update `onDidDispose` to cancel sync as well**

Replace the existing `onDidDispose` block with:

```typescript
    webviewView.onDidDispose(() => {
      if (this.generateAbortController) {
        this.generateAbortController.abort();
        this.generateAbortController = null;
      }
      if (this.syncAbortController) {
        this.syncAbortController.abort();
        // If a draft is in flight, save it before clearing
        if (this.currentNote && this.pendingFormData) {
          void this.saveCurrentAsDraft('Sync interrupted. Please retry.');
        }
        this.syncAbortController = null;
      }
      this.currentNote = null;
      this.pendingFormData = null;
    });
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: implement sync flow with stepped loader and draft on failure"
```

---

## Task 9: Implement State 8 (Duplicate handling)

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** When `findPageByTitle` returns a non-null page ID (Task 8 already shows the duplicate state), this task handles the user's choice — Append, Replace, or Cancel.

- [ ] **Step 1: Track existing page ID**

Add a private field:

```typescript
  private currentDuplicatePageId: string | null = null;
```

Update `handleClickSaveNote` — replace the duplicate-detection block (the `if (existingPageId !== null)` part) with:

```typescript
      if (existingPageId !== null) {
        this.currentDuplicatePageId = existingPageId;
        // Cache the structured content for use by the choice handler
        this.cachedStructuredContent = structuredContent;
        this.postMessage({
          type: 'setState',
          state: 'duplicate',
          data: { title: this.pendingFormData.title },
        });
        return;
      }
```

Add another private field:

```typescript
  private cachedStructuredContent: string | null = null;
```

- [ ] **Step 2: Add duplicate choice handler**

In `onDidReceiveMessage`, add this case:

```typescript
          case 'clickDuplicateChoice':
            await this.handleDuplicateChoice(msg.choice);
            break;
```

Add this method to the class:

```typescript
  private async handleDuplicateChoice(choice: 'append' | 'replace' | 'cancel'): Promise<void> {
    if (!this.currentDuplicatePageId || !this.cachedStructuredContent || !this.pendingFormData) {
      await this.refreshIdleState();
      return;
    }

    if (choice === 'cancel') {
      await this.saveCurrentAsDraft('Sync cancelled. Use Retry to sync later.');
      this.postMessage({ type: 'setDraft', draft: this.draftStore.get() });
      this.currentNote = null;
      this.pendingFormData = null;
      this.currentDuplicatePageId = null;
      this.cachedStructuredContent = null;
      this.postMessage({
        type: 'setBranchInfo',
        branch: '—',
        canGenerate: false,
        reason: 'Resolve the unsynced draft above before creating a new note.',
      });
      this.postMessage({ type: 'setState', state: 'idle' });
      return;
    }

    const notionToken = await this.configService.getNotionToken();
    const databaseId = this.configService.getNotionDatabaseId();
    if (!notionToken || !databaseId) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    this.postMessage({ type: 'setState', state: 'syncing' });
    this.postMessage({ type: 'setLoadingText', text: 'Syncing to Notion...' });

    try {
      const notionService = new NotionService(notionToken, databaseId);
      if (choice === 'append') {
        await notionService.appendBlocksToPage(this.currentDuplicatePageId, this.cachedStructuredContent);
      } else {
        await notionService.replacePageBlocks(this.currentDuplicatePageId, this.cachedStructuredContent);
      }

      await this.draftStore.clear();
      const successMessage = choice === 'append'
        ? `Note appended to existing Notion page "${this.pendingFormData.title}".`
        : `Notion page "${this.pendingFormData.title}" replaced with new content.`;

      this.postMessage({
        type: 'setState',
        state: 'success',
        data: { message: successMessage },
      });

      setTimeout(() => {
        this.currentNote = null;
        this.pendingFormData = null;
        this.currentDuplicatePageId = null;
        this.cachedStructuredContent = null;
        void this.refreshIdleState();
      }, 3000);
    } catch (err) {
      const friendlyMessage = choice === 'append'
        ? 'Couldn\'t add to existing Notion page. Please try again.'
        : 'Couldn\'t replace Notion page content. Please try again.';
      await this.saveCurrentAsDraft(friendlyMessage);
      this.postMessage({
        type: 'setState',
        state: 'sync-error',
        data: { message: friendlyMessage },
      });
    }
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: implement duplicate title handling with append/replace/cancel"
```

---

## Task 10: Implement State 11 (Draft recovery)

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** Adds draft retry and discard handlers. The draft banner is already shown by `handleReady` from Task 6 — this task adds the action handlers for the retry/discard buttons.

- [ ] **Step 1: Add draft recovery handlers**

In `onDidReceiveMessage`, add these cases:

```typescript
          case 'clickRetryDraft':
            await this.handleRetryDraft();
            break;
          case 'clickDiscardDraft':
            await this.handleDiscardDraft();
            break;
```

Add these methods to the class:

```typescript
  private async handleRetryDraft(): Promise<void> {
    const draft = this.draftStore.get();
    if (!draft) {
      await this.refreshIdleState();
      return;
    }

    // Restore in-memory state from the draft
    this.currentNote = draft.generatedNote;
    this.pendingFormData = { title: draft.title, description: draft.description };

    // Use the cached structured content if available, otherwise re-generate it via LLM
    if (draft.structuredContent) {
      this.cachedStructuredContent = draft.structuredContent;
    }

    // Re-run the sync flow
    await this.handleClickSaveNote();
  }

  private async handleDiscardDraft(): Promise<void> {
    await this.draftStore.clear();
    this.postMessage({ type: 'setDraft', draft: null });
    this.currentNote = null;
    this.pendingFormData = null;
    this.currentDuplicatePageId = null;
    this.cachedStructuredContent = null;
    await this.refreshIdleState();
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: implement draft recovery with retry and discard"
```

---

## Task 11: Implement gear icon settings access

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** When the user clicks the gear icon, open the setup state with current values pre-filled. This lets users update tokens after initial setup.

- [ ] **Step 1: Add settings handler**

In `onDidReceiveMessage`, add this case:

```typescript
          case 'openSettings':
            await this.handleOpenSettings();
            break;
```

Add this method to the class:

```typescript
  private async handleOpenSettings(): Promise<void> {
    const geminiKey = await this.configService.getGeminiApiKey();
    const notionToken = await this.configService.getNotionToken();
    const notionDbId = this.configService.getNotionDatabaseId();

    this.postMessage({
      type: 'prefillSetup',
      geminiKey: geminiKey ?? '',
      notionToken: notionToken ?? '',
      notionDbId: notionDbId ?? '',
    });
    this.postMessage({ type: 'setState', state: 'setup' });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: implement gear icon settings access with prefilled values"
```

---

## Task 12: Implement migration from v0.1.x `custom_memory_note.md`

**Files:**
- Modify: `src/SidebarProvider.ts`

**What this task does:** On first sidebar open, check if a leftover `custom_memory_note.md` file exists in the workspace. If yes, parse it into a draft and remove the file. The user sees the migrated content as a draft banner with retry/discard options.

- [ ] **Step 1: Add migration check to `handleReady`**

At the top of `src/SidebarProvider.ts`, add this import:

```typescript
import * as fs from 'fs';
import * as path from 'path';
```

(If already imported, skip.)

Replace the existing `handleReady` method with this version that includes the migration check:

```typescript
  private async handleReady(): Promise<void> {
    // One-time migration: convert leftover custom_memory_note.md to a draft
    await this.migrateLegacyFileIfExists();

    // Always refresh draft banner
    const draft = this.draftStore.get();
    this.postMessage({ type: 'setDraft', draft });

    const geminiKey = await this.configService.getGeminiApiKey();
    const notionToken = await this.configService.getNotionToken();
    const notionDbId = this.configService.getNotionDatabaseId();

    if (!geminiKey || !notionToken || !notionDbId) {
      this.postMessage({ type: 'setState', state: 'setup' });
      return;
    }

    if (this.draftStore.exists()) {
      this.postMessage({
        type: 'setBranchInfo',
        branch: '—',
        canGenerate: false,
        reason: 'Resolve the unsynced draft above before creating a new note.',
      });
      this.postMessage({ type: 'setState', state: 'idle' });
      return;
    }

    await this.refreshIdleState();
  }

  private async migrateLegacyFileIfExists(): Promise<void> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) return;

    const filePath = path.join(workspacePath, 'custom_memory_note.md');
    if (!fs.existsSync(filePath)) return;

    // If a draft already exists, do not overwrite it. Just leave the file alone.
    if (this.draftStore.exists()) return;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse the legacy format. The legacy format had YAML frontmatter:
      //   ---
      //   title: ...
      //   timestamp: ...
      //   files: [...]
      //   ---
      //   ## Summary
      //   ...
      const titleMatch = content.match(/^title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : 'Migrated draft';

      // Build a minimal StructuredNote from the file content. We don't have the
      // original generation data, so we use defaults plus the file content as the summary.
      const draftNote = {
        title,
        summary: 'Migrated from a previous DevNote local file.',
        whatChanged: ['Original content preserved below'],
        why: 'Recovered from custom_memory_note.md',
        filesAffected: [],
        keyDecisions: content,
        timestamp: new Date().toISOString(),
      };

      await this.draftStore.save({
        title,
        description: undefined,
        generatedNote: draftNote,
        lastError: 'Migrated from legacy custom_memory_note.md — please retry sync.',
        createdAt: Date.now(),
        branchName: '—',
      });

      // Remove the legacy file
      fs.unlinkSync(filePath);
    } catch {
      // Migration is best-effort. If parsing fails, leave the file alone.
    }
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/SidebarProvider.ts
git commit -m "feat: migrate leftover custom_memory_note.md to draft on first run"
```

---

## Task 13: Update `extension.ts` and `package.json` — switch to single command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`
- Modify: `src/SidebarProvider.ts`

**What this task does:** Removes the 3 redundant commands (`devnote.sync`, `devnote.setGeminiKey`, `devnote.setNotionToken`) and the `Ctrl+Alt+M` keybinding. Keeps `devnote.create` + `Ctrl+Alt+D` but rewires it to open the sidebar and auto-trigger generation.

- [ ] **Step 1: Implement `triggerGenerate` in `SidebarProvider.ts`**

Replace the placeholder `triggerGenerate` method with:

```typescript
  async triggerGenerate(): Promise<void> {
    // If the view isn't visible yet, the resolveWebviewView will run handleReady.
    // We just need to make sure idle state shows and then click generate.
    if (!this.view) {
      // View is not yet open. The webview will request 'ready' on its own.
      // We can't do much here until the user actually opens it.
      return;
    }
    // Force the idle/form transition
    await this.refreshIdleState();
    await this.handleClickGenerate();
  }
```

- [ ] **Step 2: Replace `src/extension.ts` with the cleaned-up version**

```typescript
import * as vscode from 'vscode';
import { ConfigService } from './ConfigService';
import { SidebarProvider } from './SidebarProvider';
import { DraftStore } from './DraftStore';

export function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigService(context.secrets);
  const draftStore = new DraftStore(context);

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context,
    configService,
    draftStore
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Single remaining command: opens the sidebar and auto-triggers generate
  context.subscriptions.push(
    vscode.commands.registerCommand('devnote.create', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devnote-sidebar');
      await sidebarProvider.triggerGenerate();
    })
  );
}

export function deactivate() {}
```

- [ ] **Step 3: Update `package.json` — remove old commands, keybinding, and bump version**

In `package.json`, replace the `commands` and `keybindings` sections under `contributes` with:

```json
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
```

Also bump the version from `0.1.1` to `0.2.0`:

```json
  "version": "0.2.0",
```

- [ ] **Step 4: Validate JSON and verify TypeScript compiles**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')" && npx tsc -p ./ --noEmit`
Expected: `valid` then no compilation errors.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/SidebarProvider.ts package.json
git commit -m "feat: switch to sidebar-only entry, remove 3 commands and keybinding, bump to 0.2.0"
```

---

## Task 14: Delete old files (UIService, NoteService, CommandHandler, preview.html)

**Files:**
- Delete: `src/UIService.ts`
- Delete: `src/NoteService.ts`
- Delete: `src/CommandHandler.ts`
- Delete: `webview/preview.html`

**What this task does:** Removes the now-unused files. The previous task already removed all references to them in `extension.ts`. After this task, the project is in its final clean state.

- [ ] **Step 1: Delete the four files**

Run:

```bash
rm src/UIService.ts src/NoteService.ts src/CommandHandler.ts webview/preview.html
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors. (If there are errors, it means a file is still referenced somewhere — find and fix.)

- [ ] **Step 3: Update CHANGELOG.md**

Add a new entry at the top of the version list (right after the title and intro):

```markdown
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

```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete legacy files and update CHANGELOG for 0.2.0"
```

---

## Task 15: Manual end-to-end testing

**Files:**
- No file changes — verification only

**What this task does:** Run through all 21 test scenarios from the spec to verify everything works.

- [ ] **Step 1: Compile and launch Extension Development Host**

Run: `npx tsc -p ./` (in the project root)
Then press `F5` in VS Code with the devnote project open. A second VS Code window opens with the extension loaded.

- [ ] **Step 2: Run through all 21 test scenarios**

Open `docs/superpowers/specs/2026-04-12-sidebar-redesign-design.md` and find the "Test scenarios" table. Walk through each scenario one by one, checking the expected behavior matches reality.

For each scenario, write a one-line note (✅ pass or ❌ fail with details).

- [ ] **Step 3: If any scenarios fail, file follow-up tasks**

For each failure, open a GitHub issue or note it in the project tracker. Do not silently move on. Common things to look for:
- States not transitioning correctly
- Loading text not updating
- Webview style issues at narrow widths
- Draft banner not appearing on reopen
- Migration of `custom_memory_note.md` not triggering

- [ ] **Step 4: Once all 21 pass, this task is complete**

The branch is now ready to merge to main, then bump and re-publish to Open VSX as `marudhu099.devnote@0.2.0`.
