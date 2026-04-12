# DevNote Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension with two commands — `Ctrl+Alt+D` generates a dev note from git diff and saves locally, `Ctrl+Alt+M` syncs the note to Notion.

**Architecture:** Two decoupled commands backed by 8 service files. Command 1 (create) reads git diff, sends to Gemini, previews, saves to `custom_memory_note.md`. Command 2 (sync) reads local file, structures via LLM, pushes to Notion, deletes local file. Services are independent and communicate through the CommandHandler orchestrator.

**Tech Stack:** TypeScript 5, VS Code Extension API, `simple-git`, `@google/generative-ai` (Gemini SDK), Notion REST API via `fetch`.

**Execution Mode:** Subagent-Driven Development — dispatch a fresh agent per task, review between tasks.

---

## File Map

| File | Responsibility | Created/Modified |
|---|---|---|
| `src/GitService.ts` | Check git availability, get staged + unstaged diff | Rewrite (currently stub) |
| `src/ConfigService.ts` | SecretStorage for API keys, VS Code settings for Notion DB ID | Rewrite (currently stub) |
| `src/LLMService.ts` | Interface + Gemini impl: generate note + structure for Notion | Rewrite (currently stub) |
| `src/NoteService.ts` | Read/write/delete `custom_memory_note.md` | Create (new file) |
| `src/NotionService.ts` | Push structured data to Notion REST API | Create (new file) |
| `src/UIService.ts` | Webview preview panel with approve/reject | Rewrite (currently stub) |
| `src/CommandHandler.ts` | Orchestrate both command flows | Rewrite (currently stub) |
| `src/extension.ts` | Register all 4 commands, wire to CommandHandler | Rewrite (currently stub) |
| `webview/preview.html` | Preview panel HTML/CSS/JS | Rewrite (currently skeleton) |
| `package.json` | Add new commands, keybindings, configuration | Modify |
| `.gitignore` | Ignore node_modules, out, custom_memory_note.md | Create (new file) |

---

## Task 1: Project Setup — `.gitignore` and `package.json` updates

**Files:**
- Create: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
out/
*.vsix
custom_memory_note.md
.vscode-test/
```

- [ ] **Step 2: Update `package.json` — add all 4 commands and keybindings**

Replace the `contributes` section in `package.json` with:

```json
{
  "contributes": {
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
    "keybindings": [
      {
        "command": "devnote.create",
        "key": "ctrl+alt+d",
        "when": "editorTextFocus"
      },
      {
        "command": "devnote.sync",
        "key": "ctrl+alt+m",
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

- [ ] **Step 3: Verify TypeScript compiles (empty stubs are valid)**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors (stubs have valid syntax)

- [ ] **Step 4: Commit**

```bash
git add .gitignore package.json
git commit -m "chore: add gitignore and register all MVP commands in package.json"
```

---

## Task 2: GitService — Read branch diff and uncommitted changes

**Files:**
- Rewrite: `src/GitService.ts`

- [ ] **Step 1: Implement GitService**

```typescript
// src/GitService.ts
import simpleGit, { SimpleGit } from 'simple-git';

export interface BranchDiffResult {
  branchDiff: string;
  filesChanged: string[];
  commitCount: number;
}

export interface UncommittedDiffResult {
  staged: string;
  unstaged: string;
  filesChanged: string[];
}

export class GitService {
  private readonly git: SimpleGit;

  constructor(workspacePath: string) {
    this.git = simpleGit(workspacePath);
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      return { available: false, reason: 'Not a git repository' };
    }

    // Check if on main — nothing to document
    const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    if (branch.trim() === 'main' || branch.trim() === 'master') {
      // On main — check for uncommitted changes as fallback
      const status = await this.git.status();
      const hasChanges =
        status.modified.length > 0 ||
        status.not_added.length > 0 ||
        status.staged.length > 0 ||
        status.renamed.length > 0 ||
        status.deleted.length > 0;

      if (!hasChanges) {
        return { available: false, reason: 'On main branch with no uncommitted changes' };
      }

      return { available: true };
    }

    return { available: true };
  }

  async isOnMainBranch(): Promise<boolean> {
    const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    const name = branch.trim();
    return name === 'main' || name === 'master';
  }

  async getBranchDiff(): Promise<BranchDiffResult> {
    const branchDiff = await this.git.diff(['main...HEAD']);
    const diffStat = await this.git.diff(['main...HEAD', '--name-only']);
    const filesChanged = diffStat.trim().split('\n').filter(Boolean);

    const log = await this.git.log(['main..HEAD']);
    const commitCount = log.total;

    return { branchDiff, filesChanged, commitCount };
  }

  async getUncommittedDiff(): Promise<UncommittedDiffResult> {
    const staged = await this.git.diff(['--cached']);
    const unstaged = await this.git.diff();
    const status = await this.git.status();

    const filesChanged = [
      ...new Set([
        ...status.modified,
        ...status.not_added,
        ...status.staged,
        ...status.renamed.map((entry) => entry.to),
        ...status.deleted,
      ]),
    ];

    return { staged, unstaged, filesChanged };
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/GitService.ts
git commit -m "feat: implement GitService with checkAvailability and getDiff"
```

---

## Task 3: ConfigService — API keys and settings

**Files:**
- Rewrite: `src/ConfigService.ts`

- [ ] **Step 1: Implement ConfigService**

```typescript
// src/ConfigService.ts
import * as vscode from 'vscode';

export class ConfigService {
  private secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async getGeminiApiKey(): Promise<string | undefined> {
    return this.secrets.get('devnote.geminiApiKey');
  }

  async setGeminiApiKey(key: string): Promise<void> {
    await this.secrets.store('devnote.geminiApiKey', key);
  }

  async getNotionToken(): Promise<string | undefined> {
    return this.secrets.get('devnote.notionToken');
  }

  async setNotionToken(token: string): Promise<void> {
    await this.secrets.store('devnote.notionToken', token);
  }

  getNotionDatabaseId(): string {
    const config = vscode.workspace.getConfiguration('devnote');
    return config.get<string>('notionDatabaseId', '');
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ConfigService.ts
git commit -m "feat: implement ConfigService with SecretStorage for API keys"
```

---

## Task 4: LLMService — Gemini integration

**Files:**
- Rewrite: `src/LLMService.ts`

- [ ] **Step 1: Implement LLMService interface and Gemini implementation**

```typescript
// src/LLMService.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface NotePayload {
  branchDiff: string;
  filesChanged: string[];
  commitCount: number;
  title: string;
  userNotes?: string;
  uncommittedStaged?: string;
  uncommittedUnstaged?: string;
}

export interface StructuredNote {
  title: string;
  summary: string;
  whatChanged: string[];
  why: string;
  filesAffected: string[];
  keyDecisions: string;
  timestamp: string;
}

export interface LLMService {
  generateNote(payload: NotePayload): Promise<StructuredNote>;
  structureForNotion(noteContent: string): Promise<string>;
}

export class GeminiLLMService implements LLMService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateNote(payload: NotePayload): Promise<StructuredNote> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    let uncommittedSection = '';
    if (payload.uncommittedStaged || payload.uncommittedUnstaged) {
      uncommittedSection = `

Uncommitted staged changes:
${payload.uncommittedStaged || '(none)'}

Uncommitted unstaged changes:
${payload.uncommittedUnstaged || '(none)'}`;
    }

    const prompt = `You are a developer documentation assistant. Analyze the following git diff from a feature branch and generate a structured developer note. This diff represents the entire branch compared to main (${payload.commitCount} commit(s)).

Title: ${payload.title}
${payload.userNotes ? `Developer notes: ${payload.userNotes}` : ''}

Files changed: ${payload.filesChanged.join(', ')}

Branch diff (all changes vs main):
${payload.branchDiff || '(none)'}${uncommittedSection}

Respond in this exact JSON format (no markdown fences, just raw JSON):
{
  "title": "the title",
  "summary": "one-line summary of what was done",
  "whatChanged": ["change 1", "change 2"],
  "why": "why these changes were made",
  "filesAffected": ["file1.ts", "file2.ts"],
  "keyDecisions": "any notable design decisions made",
  "timestamp": "${new Date().toISOString()}"
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed: StructuredNote = JSON.parse(cleaned);
    return parsed;
  }

  async structureForNotion(noteContent: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Convert the following developer note into a clean, readable format suitable for a Notion page. Return plain text with markdown headings and bullet points. Keep it concise and well-structured.

${noteContent}`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/LLMService.ts
git commit -m "feat: implement LLMService interface with Gemini integration"
```

---

## Task 5: NoteService — Local file read/write/delete

**Files:**
- Create: `src/NoteService.ts`

- [ ] **Step 1: Implement NoteService**

```typescript
// src/NoteService.ts
import * as fs from 'fs';
import * as path from 'path';
import { StructuredNote } from './LLMService';

export class NoteService {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  private getFilePath(): string {
    return path.join(this.workspacePath, 'custom_memory_note.md');
  }

  exists(): boolean {
    return fs.existsSync(this.getFilePath());
  }

  save(note: StructuredNote): void {
    const content = `---
title: ${note.title}
timestamp: ${note.timestamp}
files:
${note.filesAffected.map((f) => `  - ${f}`).join('\n')}
---

## Summary
${note.summary}

## What Changed
${note.whatChanged.map((c) => `- ${c}`).join('\n')}

## Why
${note.why}

## Key Decisions
${note.keyDecisions}
`;

    fs.writeFileSync(this.getFilePath(), content, 'utf-8');
  }

  read(): string {
    return fs.readFileSync(this.getFilePath(), 'utf-8');
  }

  delete(): void {
    fs.unlinkSync(this.getFilePath());
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/NoteService.ts
git commit -m "feat: implement NoteService for local custom_memory_note.md lifecycle"
```

---

## Task 6: NotionService — Push to Notion API

**Files:**
- Create: `src/NotionService.ts`

- [ ] **Step 1: Implement NotionService**

```typescript
// src/NotionService.ts

export class NotionService {
  private token: string;
  private databaseId: string;

  constructor(token: string, databaseId: string) {
    this.token = token;
    this.databaseId = databaseId;
  }

  async push(title: string, content: string): Promise<void> {
    const body = {
      parent: { database_id: this.databaseId },
      properties: {
        Name: {
          title: [{ text: { content: title } }],
        },
      },
      children: this.markdownToBlocks(content),
    };

    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }
  }

  private markdownToBlocks(content: string): object[] {
    const lines = content.split('\n');
    const blocks: object[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }],
          },
        });
      } else if (trimmed.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }],
          },
        });
      } else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: trimmed } }],
          },
        });
      }
    }

    return blocks;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/NotionService.ts
git commit -m "feat: implement NotionService with Notion REST API integration"
```

---

## Task 7: UIService — Webview preview panel

**Files:**
- Rewrite: `src/UIService.ts`
- Rewrite: `webview/preview.html`

- [ ] **Step 1: Implement UIService**

```typescript
// src/UIService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StructuredNote } from './LLMService';

export class UIService {
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  showPreview(note: StructuredNote): Promise<boolean> {
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'devnotePreview',
        `DevNote: ${note.title}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      const htmlPath = path.join(this.extensionPath, 'webview', 'preview.html');
      let html = fs.readFileSync(htmlPath, 'utf-8');
      html = html.replace('{{NOTE_DATA}}', JSON.stringify(note));
      panel.webview.html = html;

      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === 'approve') {
          panel.dispose();
          resolve(true);
        } else if (message.command === 'reject') {
          panel.dispose();
          resolve(false);
        }
      });

      panel.onDidDispose(() => {
        resolve(false);
      });
    });
  }
}
```

- [ ] **Step 2: Implement preview.html**

```html
<!-- webview/preview.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevNote Preview</title>
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground, #ccc);
      background-color: var(--vscode-editor-background, #1e1e1e);
      padding: 20px;
      line-height: 1.6;
    }
    h1 { font-size: 1.5em; margin-bottom: 4px; }
    h2 { font-size: 1.1em; margin-top: 20px; color: var(--vscode-textLink-foreground, #3794ff); }
    .summary { font-style: italic; margin-bottom: 16px; }
    .files { font-size: 0.9em; color: var(--vscode-descriptionForeground, #888); margin-bottom: 16px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 4px; }
    .actions { margin-top: 24px; display: flex; gap: 12px; }
    button {
      padding: 8px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .approve {
      background-color: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
    }
    .approve:hover { background-color: var(--vscode-button-hoverBackground, #1177bb); }
    .reject {
      background-color: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
    }
    .reject:hover { background-color: var(--vscode-button-secondaryHoverBackground, #45494e); }
  </style>
</head>
<body>
  <h1 id="title"></h1>
  <p class="files" id="files"></p>
  <p class="summary" id="summary"></p>

  <h2>What Changed</h2>
  <ul id="whatChanged"></ul>

  <h2>Why</h2>
  <p id="why"></p>

  <h2>Key Decisions</h2>
  <p id="keyDecisions"></p>

  <div class="actions">
    <button class="approve" onclick="send('approve')">Save Note</button>
    <button class="reject" onclick="send('reject')">Discard</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const note = {{NOTE_DATA}};

    document.getElementById('title').textContent = note.title;
    document.getElementById('files').textContent = note.filesAffected.join(', ');
    document.getElementById('summary').textContent = note.summary;
    document.getElementById('why').textContent = note.why;
    document.getElementById('keyDecisions').textContent = note.keyDecisions;

    const list = document.getElementById('whatChanged');
    note.whatChanged.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });

    function send(command) {
      vscode.postMessage({ command });
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/UIService.ts webview/preview.html
git commit -m "feat: implement UIService with webview preview panel"
```

---

## Task 8: CommandHandler — Orchestrate both flows

**Files:**
- Rewrite: `src/CommandHandler.ts`

- [ ] **Step 1: Implement CommandHandler**

```typescript
// src/CommandHandler.ts
import * as vscode from 'vscode';
import { GitService } from './GitService';
import { ConfigService } from './ConfigService';
import { GeminiLLMService, NotePayload } from './LLMService';
import { NoteService } from './NoteService';
import { NotionService } from './NotionService';
import { UIService } from './UIService';

export class CommandHandler {
  private configService: ConfigService;
  private uiService: UIService;
  private workspacePath: string;

  constructor(configService: ConfigService, uiService: UIService, workspacePath: string) {
    this.configService = configService;
    this.uiService = uiService;
    this.workspacePath = workspacePath;
  }

  async handleCreate(): Promise<void> {
    // 1. Check git availability
    const gitService = new GitService(this.workspacePath);
    const availability = await gitService.checkAvailability();
    if (!availability.available) {
      vscode.window.showErrorMessage(`DevNote: ${availability.reason}`);
      return;
    }

    // 2. Get API key
    const apiKey = await this.configService.getGeminiApiKey();
    if (!apiKey) {
      const action = await vscode.window.showErrorMessage(
        'DevNote: No Gemini API key set.',
        'Set API Key'
      );
      if (action === 'Set API Key') {
        await vscode.commands.executeCommand('devnote.setGeminiKey');
      }
      return;
    }

    // 3. Build payload — branch diff is primary, uncommitted is secondary
    const onMain = await gitService.isOnMainBranch();
    let payload: NotePayload;

    if (onMain) {
      // Fallback: on main, use uncommitted changes only
      const uncommitted = await gitService.getUncommittedDiff();
      payload = {
        branchDiff: '',
        filesChanged: uncommitted.filesChanged,
        commitCount: 0,
        title: '', // filled below
        uncommittedStaged: uncommitted.staged,
        uncommittedUnstaged: uncommitted.unstaged,
      };
    } else {
      // Primary: branch diff vs main
      const branchDiff = await gitService.getBranchDiff();
      payload = {
        branchDiff: branchDiff.branchDiff,
        filesChanged: branchDiff.filesChanged,
        commitCount: branchDiff.commitCount,
        title: '', // filled below
      };

      // Also include uncommitted changes if any exist
      const uncommitted = await gitService.getUncommittedDiff();
      if (uncommitted.staged || uncommitted.unstaged) {
        payload.uncommittedStaged = uncommitted.staged;
        payload.uncommittedUnstaged = uncommitted.unstaged;

        // Merge uncommitted file changes into the list
        const allFiles = new Set([...payload.filesChanged, ...uncommitted.filesChanged]);
        payload.filesChanged = [...allFiles];
      }
    }

    // 4. Get user input
    const title = await vscode.window.showInputBox({
      prompt: 'Dev note title',
      placeHolder: 'What did you work on?',
    });
    if (!title) {
      return; // User cancelled
    }
    payload.title = title;

    const userNotes = await vscode.window.showInputBox({
      prompt: 'Any additional notes? (optional — press Enter to skip)',
      placeHolder: 'Context, decisions, things to remember...',
    });
    payload.userNotes = userNotes || undefined;

    // 5. Generate note via LLM
    const llmService = new GeminiLLMService(apiKey);
    let note;
    try {
      note = await llmService.generateNote(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Failed to generate note — ${message}`
      );
      return;
    }

    // 6. Preview
    const approved = await this.uiService.showPreview(note);
    if (!approved) {
      vscode.window.showInformationMessage('DevNote: Note discarded.');
      return;
    }

    // 7. Save locally
    const noteService = new NoteService(this.workspacePath);
    noteService.save(note);
    vscode.window.showInformationMessage(
      'DevNote: Note saved! Use Ctrl+Alt+M to sync to Notion.'
    );
  }

  async handleSync(): Promise<void> {
    // 1. Check if note exists
    const noteService = new NoteService(this.workspacePath);
    if (!noteService.exists()) {
      vscode.window.showErrorMessage(
        'DevNote: No note to sync — create one first with Ctrl+Alt+D'
      );
      return;
    }

    // 2. Check Notion config
    const notionToken = await this.configService.getNotionToken();
    if (!notionToken) {
      const action = await vscode.window.showErrorMessage(
        'DevNote: No Notion token set.',
        'Set Token'
      );
      if (action === 'Set Token') {
        await vscode.commands.executeCommand('devnote.setNotionToken');
      }
      return;
    }

    const databaseId = this.configService.getNotionDatabaseId();
    if (!databaseId) {
      vscode.window.showErrorMessage(
        'DevNote: Set devnote.notionDatabaseId in VS Code settings.'
      );
      return;
    }

    // 3. Read note
    const noteContent = noteService.read();

    // 4. Get API key for LLM structuring
    const apiKey = await this.configService.getGeminiApiKey();
    if (!apiKey) {
      vscode.window.showErrorMessage(
        'DevNote: No Gemini API key set — needed to structure note for Notion.'
      );
      return;
    }

    // 5. Structure for Notion via LLM
    const llmService = new GeminiLLMService(apiKey);
    let structuredContent: string;
    try {
      structuredContent = await llmService.structureForNotion(noteContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Failed to structure note — ${message}`
      );
      return;
    }

    // 6. Push to Notion
    const notionService = new NotionService(notionToken, databaseId);
    try {
      // Extract title from frontmatter
      const titleMatch = noteContent.match(/^title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : 'DevNote';
      await notionService.push(title, structuredContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Sync failed — ${message}`
      );
      return; // Do NOT delete local file
    }

    // 7. Delete local file only after successful sync
    noteService.delete();
    vscode.window.showInformationMessage('DevNote: Note synced to Notion!');
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/CommandHandler.ts
git commit -m "feat: implement CommandHandler orchestrating create and sync flows"
```

---

## Task 9: extension.ts — Wire everything together

**Files:**
- Rewrite: `src/extension.ts`

- [ ] **Step 1: Implement extension.ts**

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { ConfigService } from './ConfigService';
import { UIService } from './UIService';
import { CommandHandler } from './CommandHandler';

export function activate(context: vscode.ExtensionContext) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    return;
  }

  const configService = new ConfigService(context.secrets);
  const uiService = new UIService(context.extensionPath);
  const handler = new CommandHandler(configService, uiService, workspacePath);

  // Command 1: Create Dev Note (Ctrl+Alt+D)
  const createCmd = vscode.commands.registerCommand('devnote.create', () => {
    handler.handleCreate();
  });

  // Command 2: Sync to Notion (Ctrl+Alt+M)
  const syncCmd = vscode.commands.registerCommand('devnote.sync', () => {
    handler.handleSync();
  });

  // Command 3: Set Gemini API Key
  const setGeminiKeyCmd = vscode.commands.registerCommand(
    'devnote.setGeminiKey',
    async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Gemini API key',
        placeHolder: 'Paste your API key here',
        password: true,
      });
      if (key) {
        await configService.setGeminiApiKey(key);
        vscode.window.showInformationMessage('DevNote: Gemini API key saved.');
      }
    }
  );

  // Command 4: Set Notion Token
  const setNotionTokenCmd = vscode.commands.registerCommand(
    'devnote.setNotionToken',
    async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Notion integration token',
        placeHolder: 'Paste your Notion token here',
        password: true,
      });
      if (token) {
        await configService.setNotionToken(token);
        vscode.window.showInformationMessage('DevNote: Notion token saved.');
      }
    }
  );

  context.subscriptions.push(createCmd, syncCmd, setGeminiKeyCmd, setNotionTokenCmd);
}

export function deactivate() {}
```

- [ ] **Step 2: Verify full project compiles**

Run: `npx tsc -p ./`
Expected: Compiles successfully, `out/` directory created with .js files

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire all commands in extension.ts entry point"
```

---

## Task 10: Manual Testing — End-to-End

- [ ] **Step 1: Press F5 in VS Code to launch Extension Development Host**

A second VS Code window opens with the extension loaded.

- [ ] **Step 2: Test `DevNote: Set Gemini API Key`**

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "DevNote: Set Gemini API Key"
3. Paste your Gemini API key
4. Expected: Notification "DevNote: Gemini API key saved."

- [ ] **Step 3: Test `DevNote: Create Dev Note` (`Ctrl+Alt+D`)**

1. Open a git repository with uncommitted changes in the Extension Development Host
2. Press `Ctrl+Alt+D`
3. Enter a title when prompted
4. Optionally enter notes
5. Expected: Webview preview opens with structured note
6. Click "Save Note"
7. Expected: `custom_memory_note.md` appears in workspace root
8. Expected: Notification "DevNote: Note saved! Use Ctrl+Alt+M to sync to Notion."

- [ ] **Step 4: Test `DevNote: Set Notion Token` and configure database ID**

1. Command Palette → "DevNote: Set Notion Token" → paste token
2. Open VS Code Settings → search "devnote" → set Notion Database ID

- [ ] **Step 5: Test `DevNote: Sync to Notion` (`Ctrl+Alt+M`)**

1. Press `Ctrl+Alt+M`
2. Expected: Note synced, notification "DevNote: Note synced to Notion!"
3. Expected: `custom_memory_note.md` deleted from workspace
4. Check Notion — new page should appear in your database

- [ ] **Step 6: Test error cases**

1. Try `Ctrl+Alt+D` in a non-git folder → should show error
2. Try `Ctrl+Alt+M` with no note file → should show error
3. Try `Ctrl+Alt+D` without API key set → should prompt to set key

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: DevNote Phase 1 MVP complete — create notes and sync to Notion"
```
