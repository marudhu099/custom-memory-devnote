# DevNote Marketplace Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all files and metadata needed to make DevNote Phase 1 MVP publish-ready for the VS Code Marketplace in a single clean branch.

**Architecture:** Six file changes — five new files (README, CHANGELOG, LICENSE, .vscodeignore) plus package.json metadata updates. No code changes, no test changes. The existing icon at `asset/icon.png` is wired in via package.json. End state is validated by running `vsce package` and producing a clean `.vsix` under 1MB.

**Tech Stack:** Markdown, JSON, VSCode Extension Manifest spec, `@vscode/vsce` (already installed transitively or via npx).

**Execution Mode:** Subagent-Driven Development — dispatch a fresh agent per task, review between tasks.

---

## File Map

| File | Responsibility | Created/Modified |
|---|---|---|
| `README.md` | Marketplace storefront — rendered as the listing page | Create |
| `CHANGELOG.md` | Version history for 0.1.0 release | Create |
| `LICENSE` | MIT license text | Create |
| `.vscodeignore` | Package exclusion rules for `.vsix` bundling | Create |
| `package.json` | Metadata refresh — description, icon, repository, license, categories, author | Modify |

---

## Task 1: Create LICENSE file

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create the LICENSE file with standard MIT text**

```
MIT License

Copyright (c) 2026 Marudhupandiyan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Verify file exists**

Run: `ls LICENSE`
Expected: `LICENSE`

- [ ] **Step 3: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

## Task 2: Create .vscodeignore

**Files:**
- Create: `.vscodeignore`

- [ ] **Step 1: Create `.vscodeignore` with exclusion rules**

```
# Source files (we ship compiled .js, not .ts)
src/**
tsconfig.json

# Dev files
.vscode/**
.vscode-test/**
.gitignore

# Docs and planning (not needed in runtime)
docs/**
devnote-extension-master.md
*.md
!README.md
!CHANGELOG.md

# Tests
test/**
**/*.test.ts
**/*.test.js
**/*.test.cjs

# Build artifacts
*.vsix
out/**/*.map

# Other
.github/**
```

- [ ] **Step 2: Verify file exists**

Run: `ls .vscodeignore`
Expected: `.vscodeignore`

- [ ] **Step 3: Commit**

```bash
git add .vscodeignore
git commit -m "chore: add .vscodeignore to exclude dev files from package"
```

---

## Task 3: Create CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create CHANGELOG.md with 0.1.0 entry**

```markdown
# Changelog

All notable changes to DevNote will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-12

### Added
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
```

- [ ] **Step 2: Verify file exists**

Run: `ls CHANGELOG.md`
Expected: `CHANGELOG.md`

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md with 0.1.0 release notes"
```

---

## Task 4: Create README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md with Standard marketplace format**

```markdown
# DevNote

> AI-generated dev notes from git diffs. Save locally, sync to Notion, never lose context again.

DevNote turns your git branch into structured developer notes. Press `Ctrl+Alt+D`, and Gemini AI analyzes your branch diff to generate a clean, structured note. Review it, save it locally, then sync to Notion when ready.

---

## Features

- **Git-aware** — reads your entire branch diff against main/master (auto-detected), not just uncommitted changes
- **AI-powered** — uses Google Gemini (free API key) to generate structured notes with summary, what changed, why, and key decisions
- **Notion sync** — one-command push to your Notion database, with the LLM structuring the data for clean Notion blocks
- **Secure** — API keys stored in VS Code's OS keychain (SecretStorage), never in plaintext
- **Decoupled flow** — create notes offline, sync when ready
- **Safe by default** — your local note is never deleted unless Notion sync succeeds

---

## Demo

> Demo GIF coming soon.

---

## Quick Start

1. **Install** — Search "DevNote" in the VS Code Extensions panel and click Install
2. **Get a free Gemini API key** — Go to [Google AI Studio](https://aistudio.google.com/apikey) and create one
3. **Set the key** — Press `Ctrl+Shift+P`, run `DevNote: Set Gemini API Key`, paste your key
4. **Create your first note** — On a feature branch with changes, press `Ctrl+Alt+D`

That's it. A preview panel opens with your structured note. Click **Save Note** and it's saved locally as `custom_memory_note.md`.

To sync to Notion, see the [Notion Integration](#setup-notion-integration) section below.

---

## How It Works

DevNote uses a two-command flow so note creation and Notion sync are decoupled.

### Command 1 — Create Note (`Ctrl+Alt+D`)

1. Reads the full diff between your branch and `main`/`master` (entire PR scope)
2. Also includes any uncommitted staged or unstaged changes
3. Prompts you for a title and optional context notes
4. Sends the diff to Gemini, which returns a structured JSON note
5. Shows a preview panel — approve to save, or discard
6. Saves to `custom_memory_note.md` in your workspace root (gitignored)

### Command 2 — Sync to Notion (`Ctrl+Alt+M`)

1. Reads `custom_memory_note.md`
2. Sends it to Gemini to format cleanly for Notion blocks
3. Pushes to your configured Notion database as a new page
4. Deletes `custom_memory_note.md` locally (only after sync succeeds)

If the Notion sync fails, your local file is preserved — no data loss.

---

## Commands & Shortcuts

| Command | Shortcut | Description |
|---|---|---|
| `DevNote: Create Dev Note` | `Ctrl+Alt+D` | Capture branch diff, generate note, save locally |
| `DevNote: Sync to Notion` | `Ctrl+Alt+M` | Push local note to Notion, delete local file |
| `DevNote: Set Gemini API Key` | — | Store Gemini API key in SecretStorage |
| `DevNote: Set Notion Token` | — | Store Notion integration token in SecretStorage |

All commands are also available via the Command Palette (`Ctrl+Shift+P`).

---

## Configuration

DevNote adds one setting to VS Code:

| Setting | Type | Default | Description |
|---|---|---|---|
| `devnote.notionDatabaseId` | string | `""` | The Notion database ID where synced notes will be created as pages |

Access via **File → Preferences → Settings** and search for "devnote".

---

## Requirements

- **VS Code** 1.85.0 or newer
- **Git repository** — DevNote reads git diffs to understand your changes
- **Gemini API key** — free from [Google AI Studio](https://aistudio.google.com/apikey)
- **Notion integration** (optional) — only needed if you want to sync notes to Notion

---

## Setup: Notion Integration

If you want to sync notes to Notion, follow these one-time setup steps.

### 1. Create a Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Name it "DevNote" and give it access to your workspace
4. Copy the **Internal Integration Token** — this is your Notion token

### 2. Create a Notion database

1. In Notion, create a new page → **Database - Full page**
2. Name it something like "Dev Notes"
3. Keep the default **Name** property (this is where titles will go)

### 3. Share the database with your integration

1. Open your database page in Notion
2. Click the **…** menu → **Connections** → Add your DevNote integration
3. Without this step, the API can't write to the database

### 4. Get the database ID

1. Open the database as a full page
2. Copy the URL — it looks like `https://notion.so/workspace/DATABASE_ID?v=...`
3. The `DATABASE_ID` is the 32-character string between `/` and `?`

### 5. Configure DevNote

1. Press `Ctrl+Shift+P`, run `DevNote: Set Notion Token`, paste your token
2. Open VS Code Settings, search "devnote", paste your database ID into `devnote.notionDatabaseId`

You're set. Next time you run `Ctrl+Alt+M`, your note will sync to Notion.

---

## Roadmap

**Phase 2 — Memory Layer** (coming soon):
- Local SQLite index of all past notes
- Context injection — past notes auto-included in LLM prompts so new notes reference earlier work
- TreeView sidebar to browse and search notes
- Pattern detection — surface recurring file changes and bug hotspots
- Auto-changelog generation from note history

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Author

Built by **Marudhupandiyan**.
```

- [ ] **Step 2: Verify file exists**

Run: `ls README.md`
Expected: `README.md`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README.md as marketplace storefront"
```

---

## Task 5: Update package.json metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update description, add new fields, update categories**

Replace the entire `package.json` content with this (preserves all existing fields, adds new ones):

```json
{
  "name": "devnote",
  "displayName": "DevNote",
  "description": "AI-generated dev notes from git diffs. Save locally, sync to Notion, never lose context again.",
  "version": "0.1.0",
  "publisher": "marudhu099",
  "author": "Marudhupandiyan",
  "license": "MIT",
  "icon": "asset/icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/marudhu099/custom-memory-devnote.git"
  },
  "bugs": {
    "url": "https://github.com/marudhu099/custom-memory-devnote/issues"
  },
  "homepage": "https://github.com/marudhu099/custom-memory-devnote#readme",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "AI",
    "SCM Providers",
    "Other"
  ],
  "keywords": [
    "git",
    "documentation",
    "ai",
    "developer notes",
    "commit",
    "notion",
    "gemini"
  ],
  "activationEvents": [],
  "main": "./out/extension.js",
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
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts",
    "test": "npm run compile && node test/run-tests.cjs",
    "test:unit": "node test/run-tests.cjs"
  },
  "devDependencies": {
    "@types/node": "^20.19.39",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "@google/generative-ai": "^0.24.1",
    "simple-git": "^3.22.0"
  }
}
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Verify TypeScript still compiles (package.json changes shouldn't break anything)**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: update package.json with marketplace metadata"
```

---

## Task 6: Validate the final package

**Files:**
- No file changes — validation only

- [ ] **Step 1: Compile the project**

Run: `npx tsc -p ./`
Expected: Compiles successfully, `out/` directory populated

- [ ] **Step 2: Package the extension with vsce**

Run: `npx -y @vscode/vsce package --no-yarn`
Expected: Creates `devnote-0.1.0.vsix` file, no errors

If vsce complains about missing repository or other fields, that means we missed something in package.json — fix and re-run.

- [ ] **Step 3: Check .vsix size**

Run: `ls -lh devnote-0.1.0.vsix`
Expected: Size under 1MB. If larger, `.vscodeignore` is missing exclusions — inspect with `npx -y @vscode/vsce ls` to see what's bundled.

- [ ] **Step 4: List the .vsix contents to verify no dev files snuck in**

Run: `npx -y @vscode/vsce ls`
Expected: Should include `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `out/extension.js` (+ other compiled files), `asset/icon.png`, `webview/preview.html`. Should NOT include `src/`, `docs/`, `test/`, `.vscode/`, `devnote-extension-master.md`, `node_modules/` (except production deps vsce auto-includes).

- [ ] **Step 5: Clean up the generated .vsix before committing**

Run: `rm devnote-0.1.0.vsix`
Expected: File removed (it's excluded by `.gitignore` and `.vscodeignore` anyway, but let's be tidy)

- [ ] **Step 6: Commit any remaining changes**

```bash
git status
```

If nothing is uncommitted, this task is done. If something changed, investigate before committing.

---

## Task 7: Final README sanity check

**Files:**
- No file changes — visual inspection

- [ ] **Step 1: Preview the README in VS Code**

Open `README.md` in VS Code and press `Ctrl+Shift+V` to open the markdown preview.

Expected: All sections render cleanly, no broken links, no raw template syntax visible, tables format correctly, headings are consistent.

- [ ] **Step 2: Verify all internal links work**

Check:
- `[LICENSE](LICENSE)` — should resolve to the LICENSE file
- `[#setup-notion-integration](#setup-notion-integration)` — should jump to that section

- [ ] **Step 3: Verify all external links are reachable**

External links to verify:
- `https://aistudio.google.com/apikey`
- `https://www.notion.so/my-integrations`
- `https://keepachangelog.com/en/1.1.0/`
- `https://semver.org/spec/v2.0.0.html`

These should all return 200 OK in a browser. (No automation needed — quick manual check.)

If all links work, the branch is done — ready to PR and merge.
