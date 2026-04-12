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
