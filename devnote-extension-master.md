# DevNote — VS Code Extension
## Master Planning Document

---

## Table of Contents

1. [The Idea](#1-the-idea)
2. [Execution Flow](#2-execution-flow)
3. [Architecture](#3-architecture)
4. [The Memory Layer](#4-the-memory-layer)
5. [Phases & Roadmap](#5-phases--roadmap)
6. [Tech Stack — Per Phase](#6-tech-stack--per-phase)
7. [Language Strategy — TS + Python](#7-language-strategy--ts--python)
8. [Getting Started (New to VS Code Extensions)](#8-getting-started-new-to-vs-code-extensions)
9. [Publishing to the Marketplace](#9-publishing-to-the-marketplace)

---

## 1. The Idea

**DevNote** is a VS Code extension that automatically generates structured developer notes from git changes — and attaches them directly to git commits.

### The core insight

Git diff is the most accurate signal of what a developer just did. Nobody is using it for documentation. DevNote captures that signal at the moment of highest context — right after a meaningful chunk of work — and turns it into a structured note.

### The problem it solves

Developer context is lost constantly. Why a change was made, what was tried, what was intentional vs. temporary — this all lives in the developer's head and disappears. Commit messages capture what changed. DevNote captures **why**.

### The key design decision

Notes are saved locally as `custom_memory_note.md` (gitignored — never committed, never pushed). When ready, the user triggers a sync to **Notion**, where the LLM structures the data for permanent storage. The local file is deleted after a successful sync. This keeps git history clean while building a searchable knowledge base in Notion.

### What gets captured

All uncommitted changes — both staged and unstaged. This captures the full picture of what the developer worked on, not just what they chose to stage.

### The bigger picture

This extension is the capture layer for **CodeVantage** (your self-healing documentation platform). Dev notes generated from git diffs are pre-documentation — structured, timestamped, file-linked developer context. The extension feeds CodeVantage's pipeline, making it smarter over time.

---

## 2. Execution Flow

```
[User Installs Extension]
        ↓
[Onboarding Screen]
  "This extension generates dev notes from Git changes"
        ↓
[Extension Activated]
        ↓
── working session ──────────────────────────────────────
        ↓
[User Works Normally in VS Code]
        ↓
[User Triggers Command]
  Shortcut: Ctrl + Alt + D
        ↓
[Check Git Availability]
  Repo exists? On a feature branch?
        ↓
[Collect Git Context]
  Primary: git diff main...HEAD (entire branch diff)
  Secondary: staged + unstaged (if any uncommitted changes)
        ↓
[Query Memory Index]              ← Phase 2 addition
  Past notes for same files
        ↓
[Inject Past Context]             ← Phase 2 addition
  Summaries → LLM payload
        ↓
[Prompt User (Light UI)]
  Title + Optional Notes
        ↓
[Prepare LLM Payload]
  diff + files + user input + context
        ↓
[Send to LLM API]
        ↓
[Generate Structured Doc]
        ↓
[Preview to User]
        ↓
[User Approves / Edits]
        ↓
[Save to custom_memory_note.md]   ← Local only, gitignored
  Note saved locally for review
        ↓
── sync (separate manual trigger in MVP) ──
        ↓
[User Triggers Sync Command]      ← Manual in MVP, automatic later
        ↓
[LLM Structures Data for Notion]
        ↓
[Push to Notion API]
        ↓
[Delete local custom_memory_note.md]
        ↓
[Background Indexer Runs]         ← Phase 2 addition
  Writes metadata to local SQLite index
```

### Why local file + Notion (not git commit attachment)

The original instinct was to attach notes to git commits. But that pollutes git history with generated content. Instead, DevNote saves locally as `custom_memory_note.md` (gitignored) and syncs to Notion on demand.

**Why Notion as permanent home:**

- Searchable, organized, shareable — better than git log for knowledge retrieval
- Structured database views — filter by date, file, project
- Team visibility without requiring git access
- The LLM structures raw notes into clean Notion entries

**Why local file as intermediate step:**

- User can review/edit before syncing
- Works offline — no internet required to capture context
- Clean lifecycle: generate → review → sync → delete

---

## 3. Architecture

### Full architecture — all layers

```
┌─────────────────────────────────────┐
│         VS Code Extension           │
│                                     │
│  ┌──────────────────────────────┐   │
│  │     extension.ts (entry)     │   │
│  └──────────────┬───────────────┘   │
│                 ↓                   │
│  ┌──────────────────────────────┐   │
│  │      CommandHandler          │   │
│  │  Orchestrates full flow      │   │
│  └──┬──────────┬────────┬───────┘   │
│     ↓          ↓        ↓           │
│  ┌──────┐ ┌────────┐ ┌─────────┐   │
│  │ Git  │ │  LLM   │ │ Memory  │   │
│  │Svc   │ │ Svc    │ │ Svc     │   │
│  └──────┘ └────────┘ └────┬────┘   │
│                            ↓        │
│               ┌────────────────┐    │
│               │ .devnotes/     │    │
│               │  index.db      │    │
│               └────────────────┘    │
└─────────────────────────────────────┘
         ↓                    ↓
  ┌────────────┐      ┌──────────────┐
  │ Anthropic  │      │  Git (local) │
  │    API     │      │   on disk    │
  └────────────┘      └──────────────┘
```

### Architecture layers explained

| Layer | Responsibility | Notes |
|---|---|---|
| `extension.ts` | Entry point. `activate()` wires everything. | ~80 lines. No business logic. |
| `CommandHandler` | Orchestrates the full flow on Ctrl+Alt+D | The only place that knows the sequence |
| `GitService` | Reads diff, staged files, commit data | Wraps simple-git or GitPython |
| `LLMService` | Interface for doc generation | Swappable — Anthropic, OpenAI, Ollama |
| `MemoryService` | SQLite index read/write | Phase 2. Query by files, inject context |
| `UIService` | Webview preview panel + TreeView sidebar | VS Code native components |
| `ConfigService` | API key, user preferences | SecretStorage for secrets |
| `.devnotes/index.db` | Local SQLite memory index | In workspace, gitignored, rebuildable |

### The LLMService interface — most important design decision

Never call the Anthropic SDK directly from your command handler. Wrap it:

```typescript
interface LLMService {
  generateNote(payload: NotePayload): Promise<StructuredNote>;
}

// Phase 1: Anthropic TS SDK
class AnthropicLLMService implements LLMService { ... }

// Phase 3: delegates to Python subprocess
class PythonLLMService implements LLMService { ... }
```

Swapping providers later (OpenAI, Gemini, local Ollama) is then a one-file change.

---

## 4. The Memory Layer

The memory layer transforms DevNote from a note-taking tool into a tool that **gets smarter over time**.

### What it does

Each note is indexed locally after saving. On the next trigger, the index is queried for past notes touching the same files — and their summaries are injected into the LLM prompt. The generated doc can then say things like "this continues the refactor started on Tuesday" instead of describing the change in isolation.

### The index schema

```sql
CREATE TABLE dev_notes (
  id          INTEGER PRIMARY KEY,
  commit_hash TEXT NOT NULL,        -- pointer back into git
  files       TEXT NOT NULL,        -- JSON array of changed paths
  timestamp   INTEGER NOT NULL,     -- unix timestamp
  title       TEXT NOT NULL,        -- user's title
  summary     TEXT NOT NULL         -- LLM-generated one-liner
);
```

### Two query paths

**Context injection** (runs before LLM call):
```sql
SELECT summary FROM dev_notes
WHERE files LIKE '%auth/service.ts%'
ORDER BY timestamp DESC
LIMIT 3;
```
Returns last 3 note summaries for the same files → appended to LLM prompt.

**Retrieval UI** (runs when user searches sidebar):
```sql
SELECT * FROM dev_notes
WHERE title LIKE '%refactor%'
ORDER BY timestamp DESC;
-- Then: git show <commit_hash> for full note
```

### Key design principle

The index is **disposable**. If it gets corrupted or deleted, you rebuild it entirely by walking `git log`. This means:
- It can be safely `.gitignore`d
- There is zero data loss risk
- It can be shared across teammates via a shared git remote (the full notes live in git history already)

### Pattern detection (Phase 2+)

Once you have the index, you can surface insights:

- "You've modified `auth/service.ts` 4 times in 2 weeks" — surfaces recurring problem areas
- Auto-generated changelog: stitch notes together into a narrative of what changed and why
- Team feed: notes from the whole org, not just one developer

---

## 5. Phases & Roadmap

### Phase 1 — MVP (Ship this first)

**Goal:** Validate the core loop. Trigger → diff → LLM → local note → manual sync to Notion. Get on the Marketplace.

**Build:**
- Ctrl+Alt+D trigger
- simple-git diff collection (staged + unstaged)
- Gemini SDK call (free API key for MVP — swappable via LLMService interface)
- Webview preview panel
- Save note to local `custom_memory_note.md` (gitignored)
- Manual "Sync to Notion" command — LLM structures data, pushes to Notion API, deletes local file
- Bring-your-own API key (SecretStorage)
- Onboarding screen
- Marketplace listing (README + demo GIF + icon)
- VS Code Telemetry wired in

**Validation signal:** Do developers use it more than once? Daily use = you've got something.

---

### Phase 2 — Memory Layer (After first 100 users)

**Goal:** Make notes contextual. Make the extension feel like it knows your codebase.

**Build:**
- `better-sqlite3` local index
- Background indexer (runs after each commit save)
- Context injection (past notes → LLM payload)
- VS Code TreeView retrieval sidebar
- Search by file, date, keyword
- Pattern detection — recurring file warnings
- Auto-changelog generation

**Validation signal:** Do users search the sidebar? Do they mention "it remembered" in reviews?

---

### Phase 3 — Python Bridge (When memory/LLM logic gets complex)

**Goal:** Migrate all AI/data logic to Python. Learn the AI engineering stack properly.

**Build:**
- `main.py` JSON-RPC handler
- `git_service.py` — GitPython for deeper analysis
- `llm_service.py` — Anthropic Python SDK + Pydantic output validation
- `memory_service.py` — sqlite3 stdlib
- `prompt_builder.py` — context injection, prompt templates
- TS shell stays thin — just spawns Python and renders results
- Python env detection at activation

**What you learn:** asyncio, Pydantic v2, GitPython, Anthropic Python SDK patterns, subprocess IPC, JSON-RPC, prompt engineering in Python.

---

### Phase 4 — CodeVantage Pipeline

**Goal:** Extension becomes the capture layer for CodeVantage. Python core is reused directly.

**Build:**
- `sync_service.py` — pushes notes to CodeVantage API after each save
- Proxy API backend — CodeVantage hosts LLM calls, no user API key needed
- Team dashboard — notes across the whole org
- Multi-LLM support via existing `LLMService` interface (OpenAI, Ollama)
- Open VSX publish (Cursor, VSCodium, Windsurf users)

**The big payoff:** The same `git_service.py`, `llm_service.py`, `memory_service.py` you built in Phase 3 plug directly into CodeVantage's backend. Zero rewrite. You built the library once and used it in two products.

---

## 6. Tech Stack — Per Phase

### Phase 1 — Pure TypeScript

| Technology | Layer | Why |
|---|---|---|
| TypeScript 5 | Everything | VS Code API is TS-native. No real alternative. |
| VS Code Extension API | Shell, UI, config | Commands, webview, secrets, telemetry |
| `simple-git` (npm) | Git integration | Typed wrapper, cross-platform, no shell escaping |
| Anthropic TS SDK | LLM calls | Behind `LLMService` interface from day one |
| VS Code SecretStorage | API key storage | OS keychain — never plaintext in settings.json |
| VS Code Webview | Preview panel | Vanilla JS — no React overhead for MVP |
| VS Code Telemetry API | Usage tracking | Respects user opt-out automatically |
| `esbuild` + `vsce` | Build + publish | Fast bundling, official VS Code CLI |

---

### Phase 2 — TS + SQLite

Everything from Phase 1, plus:

| Technology | Layer | Why |
|---|---|---|
| `better-sqlite3` (npm) | Memory index | Sync API, zero infra, ships in extension bundle |
| VS Code TreeView API | Retrieval sidebar | Native feel — users already know how to use it |
| SQLite FTS5 | Note search | Full-text search built into SQLite, zero extra infra |

---

### Phase 3 — TS Shell + Python Core

TypeScript shell (unchanged):

| Technology | Layer | Why |
|---|---|---|
| VS Code Extension API | Shell only | Register command, spawn Python, show webview |
| `child_process` (Node stdlib) | IPC | Spawn and communicate with Python subprocess |

Python core (new):

| Technology | Layer | Why |
|---|---|---|
| Anthropic Python SDK | LLM calls | Richer features, better Python ecosystem fit |
| `GitPython` | Git integration | Deeper diff analysis, better cross-platform |
| `sqlite3` (Python stdlib) | Memory index | Built-in, zero install |
| `Pydantic v2` | Output validation | Validates LLM structured outputs with type safety |
| `asyncio` | Subprocess | Non-blocking reads from VS Code's Node process |
| `uv` | Python env mgmt | Fastest Python package manager — replaces pip/venv |

---

### Phase 4 — Full Stack

Everything from Phase 3, plus:

| Technology | Layer | Why |
|---|---|---|
| `httpx` (Python) | CodeVantage API | Async HTTP client |
| `FastAPI` (Python) | Proxy backend | LLM proxy so users don't need their own API key |
| OpenAI Python SDK | Multi-LLM | Alternative LLM provider via same interface |
| Ollama Python client | Local models | Privacy-focused users, no API key needed |

---

## 7. Language Strategy — TS + Python

### The rule

> **VS Code API → TypeScript. AI / data logic → Python.**

### What lives in TypeScript (always)

- `extension.ts` entry point
- Command registration (`vscode.commands.registerCommand`)
- Keyboard shortcut wiring (`contributes.keybindings`)
- Webview panel rendering
- TreeView sidebar
- Notifications and input boxes
- SecretStorage (API key)
- Telemetry

TypeScript here because these are VS Code APIs. There is no Python equivalent.

### What lives in Python (Phase 3+)

- LLM API calls
- Prompt building and context injection
- SQLite index read/write
- Pattern detection
- Structured output validation (Pydantic)
- Git deep analysis (GitPython)

Python here because this is where the AI ecosystem lives. Pydantic, asyncio, the Anthropic Python SDK's full feature set — no TypeScript equivalent.

### What starts TS and migrates to Python

| Feature | MVP (TS) | Phase 3 (Python) |
|---|---|---|
| Git integration | `simple-git` | `GitPython` |
| LLM calls | Anthropic TS SDK | Anthropic Python SDK |
| Note storage logic | Git commit via TS | Python handles indexing |
| Prompt building | Inline in CommandHandler | `prompt_builder.py` |

### The IPC bridge (Phase 3)

The bridge between TS and Python is intentionally minimal:

```typescript
// TypeScript side — send request
process.stdin.write(
  JSON.stringify({ action: 'create_note', payload: { diff, title } }) + '\n'
);
```

```python
# Python side — handle it
import sys, json

for line in sys.stdin:
    req = json.loads(line)
    if req['action'] == 'create_note':
        result = handle_create_note(req['payload'])
        print(json.dumps(result), flush=True)
```

That's the entire bridge. Everything else is Python.

---

## 8. Getting Started (New to VS Code Extensions)

### Mental model — map to what you already know

| Web development | VS Code extension |
|---|---|
| Node.js backend | Extension host (Node.js) |
| React / HTML frontend | Webview panel (literally an iframe) |
| REST API / fetch() | postMessage API |
| Express route handler | `vscode.commands.registerCommand` |
| .env / secrets manager | SecretStorage API |
| package.json scripts | package.json + `contributes{}` |

### The one genuinely new concept: `contributes{}`

In a VS Code extension, `package.json` does more than dependencies. It declares everything your extension contributes to the editor — before any code runs:

```json
{
  "contributes": {
    "commands": [{
      "command": "devnote.create",
      "title": "Create Dev Note"
    }],
    "keybindings": [{
      "command": "devnote.create",
      "key": "ctrl+alt+d"
    }]
  }
}
```

VS Code reads this at install time. No code runs. Think of it as a manifest.

### Scaffold and first run

```bash
# Install the scaffolding tool
npm install -g yo generator-code

# Scaffold a new extension
yo code
# Choose: New Extension (TypeScript)

# Open in VS Code, press F5
# A second VS Code window opens — that's your extension running
```

The F5 dev loop is your best friend. Every save → F5 → extension reloads. Exactly like browser hot reload.

### Your first command

```typescript
// extension.ts
export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand('devnote.create', async () => {
    // 1. Get git diff
    const git = simpleGit(vscode.workspace.rootPath);
    const diff = await git.diff(['HEAD']);

    // 2. Show input box
    const title = await vscode.window.showInputBox({
      prompt: 'Dev note title'
    });

    // 3. Call LLM
    // 4. Show preview
    // 5. Attach to commit
  });

  context.subscriptions.push(cmd);
}
```

### Recommended folder structure (Phase 1)

```
devnote/
├── package.json          ← contributes, publisher, version
├── tsconfig.json
├── esbuild.js
├── src/
│   ├── extension.ts      ← entry point
│   ├── CommandHandler.ts ← orchestrates the flow
│   ├── GitService.ts     ← simple-git wrapper
│   ├── LLMService.ts     ← interface + Anthropic impl
│   ├── UIService.ts      ← webview panel
│   └── ConfigService.ts  ← secrets + settings
├── webview/
│   └── preview.html      ← preview panel UI
├── README.md             ← your marketplace storefront
└── CHANGELOG.md
```

---

## 9. Publishing to the Marketplace

### One-time setup

**Step 1 — Create Microsoft account + Azure DevOps org**

The marketplace is owned by Microsoft. You need a free Microsoft account (outlook.com works fine). Then go to `dev.azure.com` and create a free organisation — 2 minutes.

**Step 2 — Generate a Personal Access Token (PAT)**

Inside Azure DevOps → User Settings → Personal Access Tokens. Create a token with `Marketplace → Manage` scope. Copy it — you only see it once.

**Step 3 — Create a publisher profile**

Go to `marketplace.visualstudio.com/manage`. Create a publisher ID (e.g. `aswin`). This is your namespace. Add it to `package.json`:

```json
{
  "publisher": "your-publisher-id",
  "name": "devnote",
  "displayName": "DevNote",
  "description": "Generate dev notes from git changes, attached to commits"
}
```

---

### Every release

**Step 4 — Install vsce and login**

```bash
npm install -g @vscode/vsce
vsce login your-publisher-id
# Paste your PAT when prompted
```

**Step 5 — Bump version**

```json
{ "version": "0.1.0" }   // MVP
{ "version": "0.2.0" }   // Memory layer
{ "version": "1.0.0" }   // When you're confident
```

**Step 6 — Publish**

```bash
vsce publish          # Package + upload in one shot
vsce package          # .vsix file only (for local testing)
```

Live on the marketplace within minutes.

---

### What makes the listing work

Your `README.md` is your entire storefront. It renders as the extension's marketplace page. Structure it like this:

```markdown
# DevNote

Generate structured developer notes from git changes.
Attaches directly to your git commits.

## Demo
[GIF showing the extension in action — 10 seconds]

## Features
- Trigger with Ctrl+Alt+D
- Reads your git diff automatically
- AI-generated structured note
- Attached to your commit — visible in git log and PR reviews

## Requirements
- A git repository
- An Anthropic API key (get one at console.anthropic.com)

## Setup
1. Install the extension
2. Open Command Palette → "Set API Key"
3. Start coding. Press Ctrl+Alt+D when ready to note.
```

**Keywords in `package.json`** — what drives search visibility:

```json
{
  "keywords": ["git", "documentation", "ai", "developer notes", "commit"],
  "categories": ["Other"]
}
```

---

### How users find and install it

**Three ways:**

1. **In VS Code** — `Ctrl+Shift+X` → search "devnote" or "dev notes git" → Install
2. **Marketplace website** — `marketplace.visualstudio.com` → search → "Install" button opens VS Code automatically
3. **Direct URL** — share `marketplace.visualstudio.com/items?itemName=your-publisher.devnote` anywhere

**What drives installs:**

- A demo GIF in README gets 5x more installs than text alone
- Install count snowballs — get first 50 from your own network (Twitter/X, r/vscode, dev communities), then search ranking takes over
- Star ratings matter — ask early users to leave a review

---

### Also publish to Open VSX

Open VSX is the marketplace for non-Microsoft VS Code forks: Cursor, VSCodium, Windsurf. Same extension, one extra command:

```bash
npx ovsx publish -p <open-vsx-token>
```

Worth doing once you're on the main marketplace. Doubles your reach with zero extra work.

---

## Quick Reference Card

```
PHASE 1 (MVP — Pure TS)
  Stack:     TypeScript, VS Code API, simple-git, Gemini SDK
  Flow:      Ctrl+Alt+D → diff → LLM → preview → save local → manual sync to Notion
  Storage:   Local custom_memory_note.md (gitignored) → Notion (permanent)
  Goal:      Marketplace listing, first 100 users

PHASE 2 (Memory — Still TS)
  Adds:      better-sqlite3, TreeView sidebar, context injection
  Flow:      + query index → inject context → index after save
  Goal:      Daily use, sidebar searches in reviews

PHASE 3 (Python Bridge)
  Stack:     Thin TS shell + Python subprocess (JSON-RPC)
  Python:    Anthropic SDK, GitPython, sqlite3, Pydantic, asyncio
  Goal:      AI engineering skills, richer logic

PHASE 4 (CodeVantage)
  Adds:      httpx, FastAPI, OpenAI SDK, Ollama
  Goal:      Extension as CodeVantage capture layer

PUBLISH
  1. Microsoft account + Azure DevOps
  2. PAT with Marketplace → Manage scope
  3. publisher ID in package.json
  4. vsce publish
  5. Also: npx ovsx publish (for Cursor/VSCodium)
```

---

*DevNote — from git diff to institutional knowledge.*
