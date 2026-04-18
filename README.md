# DevNote

> **AI memory for developers. Never lose context on your own code.**

You open a PR from two weeks ago and you can't remember why you made those decisions. You ask an AI for help and have to re-explain your codebase every single chat. Your past self doesn't talk to your present self, and the AI tools you work with don't remember you.

**DevNote fixes both.** It captures every decision you make as you make it — reads your git diff, uses Gemini AI to write a structured note, saves it permanently to your own Notion workspace *and* to a local memory inside your editor. Your code gets a brain. The context stays with you forever.

Built into VS Code. One keyboard shortcut. No leaving your editor.

---

## What makes DevNote different

- **It remembers.** Every synced note is stored locally in a SQLite memory (`devnote.db`) on your machine *and* synced to Notion. You get a Recent Notes list in the sidebar — browse and re-read any past note instantly, no network call, works on a plane.
- **It's AI-first, not AI-flavored.** Gemini reads your entire branch diff and writes a structured note with Summary, What Changed, Why, Key Decisions, and Files Affected — not a generic "commit message on steroids."
- **It respects your flow.** Lives in a persistent sidebar panel — no modal interruptions, no extra tabs, no context switches. Draft recovery if something fails mid-sync. You never lose work.
- **It's honest about scope.** Notion is your human-readable archive (shareable, mobile, team-facing). SQLite is DevNote's own brain (fast, offline, MCP-ready). Both layers earn their place.
- **It's open and private.** Your notes are yours. Secrets live in VS Code's SecretStorage (OS keychain). The local memory is a single `devnote.db` file in your user storage — delete it anytime with one button.

---

## How it works — the flow in one picture

```text
   ┌─────────────────────────────────────────────────────────┐
   │   1. You work. Make commits, changes, decisions.         │
   └─────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │   2. Press Ctrl+Alt+D. DevNote sidebar opens.            │
   │      Type a title, optional description.                 │
   └─────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │   3. Gemini reads your branch diff (main...HEAD)
          and you commits, commands
   │      and generates a structured dev note.                │
   └─────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │   4. Preview the note. Approve → synced to Notion AND   │
   │      stored in your local memory (devnote.db).           │
   └─────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │   5. The note appears in "Recent Notes" inside the      │
   │      sidebar forever. Click to re-read. Offline. Instant.│
   └─────────────────────────────────────────────────────────┘
```

**Two destinations, one action:**

- **Notion** → the pretty, shareable, mobile-readable archive for humans
- **Local SQLite** → DevNote's own brain — powers search, RAG, and AI memory features

### What feeds into the note today (v0.3.0)

Gemini generates the structured note from:

- **Full git diff** (`main...HEAD`) — every added/removed line across the branch
- **Uncommitted changes** — staged + unstaged diffs if you haven't committed yet
- **Files changed list** — the paths touched in this branch
- **Commit count** — how many commits are on the branch (the number, not the messages yet — see *Beyond Phase 2* below)
- **Your form inputs** — the title (required) and optional description you type

That's it. No hidden markers, no parsing of `// TODO` comments, no magic directives inside your code. Honest, inspectable, and tight.

---

## Features

### Currently shipping (v0.3.0)

#### Generate & sync

- 🧠 Branch-aware AI notes — reads your entire diff vs `main`/`master` (auto-detected)
- ✏️ Smart prompts — Gemini returns structured JSON: Summary, What Changed, Why, Key Decisions, Files Affected
- 🔄 Automatic Gemini model fallback (`gemini-2.5-flash` → `gemini-2.5-flash-lite`) when one is overloaded
- 📤 Notion sync with duplicate handling — Append, Replace, or Cancel when a title collides
- 💾 Draft recovery — if sync fails, your note survives restarts and shows as a banner

#### Recent Notes (v0.3.0's headline feature)

- 📜 Every synced note saved to a local SQLite memory (`devnote.db`)
- 👀 Recent Notes list in the sidebar — scroll through your full history
- ⚡ Click any note → instant local preview (offline, no Notion round-trip)
- 🔗 Full-width "Open in Notion" button inside the preview for sharing/mobile
- 🧹 "Clear all memory" with optional backup-to-JSON export and a safe confirmation popup

#### Developer experience

- 🎨 Persistent sidebar panel with a proper state machine — no modal disruptions
- ⌨️ Single keyboard shortcut: `Ctrl+Alt+D`
- 🔐 Secrets in VS Code SecretStorage (OS keychain) — never in plaintext
- 🪪 Verified publisher on Open VSX

---

## Quick Start

1. **Install** — search "DevNote" in the VS Code Extensions panel, or install the [`.vsix` from Open VSX](https://open-vsx.org/extension/marudhu099/devnote)
2. **Open the sidebar** — click the DevNote brain icon in the activity bar (left-side column)
3. **First-time setup** — the sidebar shows a setup screen. Paste three things:
   - Your **Gemini API Key** ([get one free](https://aistudio.google.com/apikey))
   - Your **Notion Integration Token** ([create one here](https://www.notion.so/my-integrations))
   - Your **Notion Database ID** ([how to find it](https://developers.notion.com/docs/working-with-databases#adding-pages-to-a-database))
4. **Create your first note** — on a feature branch with changes, press `Ctrl+Alt+D` or click **Generate Doc** in the sidebar. Fill the form. Approve. Done.

That's it. The note lands in your Notion database *and* appears in the Recent Notes list in the sidebar, forever.

---

## Commands & Shortcuts

DevNote is now a **single-command extension**. Everything else lives in the sidebar.

| Command | Shortcut | Description |
|---|---|---|
| `DevNote: Create Dev Note` | `Ctrl+Alt+D` | Opens the sidebar and triggers the generate flow |

All legacy commands (`DevNote: Sync to Notion`, `DevNote: Set Gemini API Key`, `DevNote: Set Notion Token`) were removed in v0.2.0 — the sidebar handles all of that in-place. Use the gear icon (⚙️) in the sidebar header to access Settings.

---

## Setup: Notion Integration

Full step-by-step setup (5 minutes, one-time):

### 1. Create a Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **+ New integration**
3. Name it "DevNote" and give it access to your workspace
4. Copy the **Internal Integration Token** — this is your Notion token

### 2. Create a Notion database

1. In Notion, create a new page → **Database → Full page**
2. Name it "Dev Notes" (or anything you like)
3. Keep the default **Name** property — that's where DevNote writes your note titles

### 3. Share the database with your integration

1. Open your database page
2. Click the **…** menu → **Connections** → Add the DevNote integration
3. Without this step, the API can't write to the database

### 4. Get the database ID

1. Open your database as a full page
2. Copy the URL — looks like `https://notion.so/workspace/DATABASE_ID?v=...`
3. The **DATABASE_ID** is the 32-character string between `/` and `?`

### 5. Paste everything into DevNote's sidebar setup

On first launch, the sidebar shows a setup form. Paste the Gemini key, Notion token, and database ID → click **Save**. You're live.

---

## Where your memory lives

DevNote stores your local memory at:

| OS | Path |
|---|---|
| **Windows** | `%APPDATA%\Code\User\globalStorage\marudhu099.devnote\devnote.db` |
| **macOS** | `~/Library/Application Support/Code/User/globalStorage/marudhu099.devnote/devnote.db` |
| **Linux** | `~/.config/Code/User/globalStorage/marudhu099.devnote/devnote.db` |

A typical year of heavy use is under **10 MB**. Smaller than a single phone photo. The file is cleaned up automatically when you uninstall DevNote. You can wipe it anytime via **Settings → Clear all memory** (with optional JSON backup export).

---

## Configuration

DevNote adds one VS Code setting:

| Setting | Type | Default | Description |
|---|---|---|---|
| `devnote.notionDatabaseId` | string | `""` | The Notion database ID where synced notes are created |

The Gemini key and Notion token are stored in VS Code's SecretStorage, not in settings.

---

## Requirements

- **VS Code** 1.85.0 or newer
- **A git repository** — DevNote reads git diffs to understand your changes
- **Gemini API key** (free) — [Google AI Studio](https://aistudio.google.com/apikey)
- **Notion workspace** with an integration token and a database ID

---

## Roadmap — Phase 2: AI Memory Arc

DevNote's vision is to evolve from a **one-way publisher** into a **true AI memory layer** for developers. The plan is three releases:

### ✅ v0.3.0 — Recent Notes *(shipped)*

Every synced note gets a permanent home in a local SQLite database. A scrollable Recent Notes list in the sidebar. Click any note → instant inline preview served from local storage. Clear all memory with confirmation and optional export. **SQLite foundation for everything that follows.**

### 🚧 v0.4.0 — Semantic Search *(in progress)*

Type a natural-language question into the sidebar ("notion rate limit thing", "the SQLite decision") and DevNote returns your most relevant past notes — **ranked by meaning, not keywords**. Powered by Gemini `text-embedding-005` (768-dim vectors) + brute-force cosine similarity over your local memory. Under 50ms for thousands of notes. TypeScript + Python hybrid starts here — Python owns the AI/ML layer.

### 💡 v0.5.0 — *(coming soon)*

The memory becomes reasoning-ready. Details to be shared when we get there.

---

## Beyond Phase 2 — planned enhancements

Ideas we're deliberately NOT shipping during the Phase 2 memory arc, but actively tracking for the releases after v0.5.0. Listed here so the direction is transparent.

### Richer note generation inputs

Today Gemini sees the **diff + files changed + commit count**. Post-v0.5.0 we plan to extend this with:

- **Commit messages** folded into the prompt — your own intent, encoded in messages like `fix: prevent sync from deleting local file on 429`, is invisible to the AI right now. Adding subject lines (and optionally bodies) gives Gemini the narrative you already wrote.
- **Smart commit filtering** — drop low-signal commits (`wip`, single-letter, merge commits) so the prompt stays focused.

### Notion as an optional sync target

Today all three credentials (Gemini key, Notion token, Notion DB ID) are required. Post-v0.5.0 we plan to support a **local-only mode** for devs who don't use Notion — DevNote would work entirely off the local memory (`devnote.db`) with no Notion dependency. The "Open in Notion" affordance would simply hide for local-only notes.

### Per-note delete from the Recent Notes list

Today you can only **Clear all memory** (the nuke button). Post-v0.5.0 we plan to add a per-note delete action so you can remove a single bad/embarrassing/obsolete note without wiping your whole history. Open question we'll brainstorm when we get there: does deleting locally also archive the Notion page, or leave Notion alone?

### One-time Notion import (historical backfill)

Today v0.3.0 starts with an **empty local memory** — existing Notion pages from your v0.1.x/v0.2.0 era are not imported automatically (the reverse transformation is lossy). Post-v0.5.0 we plan to offer a `DevNote: Import from Notion` command for users who want their full Notion archive pulled into local memory, with clear warnings about reconstruction fidelity.

### Inline note editing and annotations

Today the Recent Notes preview is **read-only**. If you want to edit, you open Notion. Post-v0.5.0 we're evaluating whether DevNote itself should support in-place annotations and edits — this is a meaningful product-mode shift (capture + recall → capture + author), so we're not committing to it until user demand is clear.

### Product visuals

Screenshots and short GIFs of the sidebar flow in the README and Open VSX listing — following real feedback that the Notion sync feature is currently undiscoverable for new users.

---

## Why DevNote exists

Developers lose context on their own code. Two weeks after you ship a feature, you open the PR and stare at your own diff like it was written by a stranger. AI tools lose context too — every new chat starts blank. You re-explain your codebase, your decisions, your constraints every time.

DevNote solves both with one mechanism: **capture every decision as you make it, store it permanently, feed it back to whoever needs it later — future-you, future-AI, or your teammates.**

That's the soul. Not a note-taking app. Not a dev journal. A **memory layer that makes forgetting structurally impossible** for developers and the AI tools they work with.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Author

Built by **Marudhupandiyan** ([@marudhu099](https://github.com/marudhu099)) as part of the CodeVantage platform.

Feedback, issues, feature requests → [GitHub issues](https://github.com/marudhu099/custom-memory-devnote/issues).
