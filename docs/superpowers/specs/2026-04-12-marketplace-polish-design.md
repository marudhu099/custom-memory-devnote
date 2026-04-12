# DevNote — Marketplace Polish Design Spec

## Overview

Prepare DevNote Phase 1 MVP for publication to the VS Code Marketplace. This spec covers all file additions and metadata updates needed to go from "works locally" to "ready for `vsce publish`".

Out of scope: the actual publishing step (requires manual Azure DevOps setup, PAT generation, and `vsce login`) — that happens after this branch is merged.

---

## Goal

One-shot polish: create all storefront files and update metadata in a single branch so that running `vsce package` produces a clean, professional `.vsix` ready for publish.

---

## Deliverables

| File | Action | Purpose |
|---|---|---|
| `README.md` | Create | Marketplace storefront — rendered as the listing page |
| `CHANGELOG.md` | Create | Version history, starts with 0.1.0 entry |
| `LICENSE` | Create | MIT license text with Marudhupandiyan + 2026 |
| `.vscodeignore` | Create | Excludes dev files from `.vsix` package |
| `package.json` | Modify | Add metadata fields, refresh description, update categories |
| `asset/icon.png` | Reference | Already exists — wire it up via package.json |

---

## Repository

GitHub: `https://github.com/marudhu099/custom-memory-devnote` (public)

---

## package.json Updates

### Description refresh

```json
"description": "AI-generated dev notes from git diffs. Save locally, sync to Notion, never lose context again."
```

Old description said "attached to commits" — outdated, doesn't match what we built.

### New fields

```json
"icon": "asset/icon.png",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/marudhu099/custom-memory-devnote.git"
},
"bugs": {
  "url": "https://github.com/marudhu099/custom-memory-devnote/issues"
},
"homepage": "https://github.com/marudhu099/custom-memory-devnote#readme",
"author": "Marudhupandiyan"
```

### Category update

```json
"categories": ["AI", "SCM Providers", "Other"]
```

Old was just `["Other"]` — limits discoverability.

### Unchanged

All `contributes`, `scripts`, `dependencies`, `devDependencies`, `main`, `engines`, `name`, `displayName`, `version`, `publisher`, `keywords`.

---

## README.md Structure

Standard format — ~250 lines. Sections in order:

1. **Title + tagline** — one-line pitch at the top
2. **Features** — bulleted list of 4-5 key features
3. **Demo** — placeholder for GIF (to add post-publish)
4. **Quick Start** — 4-step install and first-use guide
5. **How It Works** — brief explanation of the two-command flow with example
6. **Commands & Shortcuts** — table of all 4 commands and keybindings
7. **Configuration** — table of `devnote.notionDatabaseId` setting
8. **Requirements** — VS Code version, git repo, Gemini API key, optional Notion
9. **Setup: Notion Integration** — step-by-step for getting Notion token and database ID
10. **Roadmap** — brief preview of Phase 2 (memory layer, sidebar, context injection)
11. **License** — MIT, reference to LICENSE file
12. **Author** — Marudhupandiyan

The demo GIF is the one thing that drives 5x more installs (per master doc), so we leave a clean placeholder and it can be added in a follow-up commit before actual publish.

---

## CHANGELOG.md Structure

Follows [Keep a Changelog](https://keepachangelog.com) format. First entry:

```markdown
# Changelog

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
- Error handling: never delete local file unless sync succeeds
```

---

## LICENSE

Standard MIT license template. Copyright line:

```
Copyright (c) 2026 Marudhupandiyan
```

---

## .vscodeignore

Controls `.vsix` package contents. Without this, the package bloats from ~50KB to 50MB+.

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

Key rules:
- `src/**` excluded — ship compiled `out/**/*.js` only
- `*.md` excluded then `!README.md` and `!CHANGELOG.md` re-included (marketplace renders README as listing)
- `.map` files excluded from `out/` — source maps not needed at runtime
- `node_modules` not listed because `vsce` auto-excludes it and bundles production deps only

---

## Validation

Before the branch is considered done:

1. `npx tsc -p ./` compiles cleanly
2. `npx vsce package` succeeds and produces a `.vsix` file
3. `.vsix` size is reasonable (< 1MB — anything larger means `.vscodeignore` missed something)
4. README renders correctly when viewed on GitHub
5. `package.json` passes VS Code extension manifest validation

---

## What's NOT in this spec

- Onboarding screen / welcome panel (deferred — the "Set API Key" commands are sufficient for now)
- Demo GIF creation (add post-publish in a follow-up)
- Open VSX publishing (VS Code Marketplace only per user decision)
- Screenshots in README (deferred with the GIF)
- Automated tests for polish files (the code tests from Phase 1 still work)
- Actual publishing: Azure DevOps account, PAT generation, `vsce login`, `vsce publish` (manual post-merge)

---

## Future-Proofing

- README structure leaves space for demo media additions without restructuring
- `.vscodeignore` uses negation patterns so adding new top-level `.md` files doesn't break packaging
- `package.json` metadata follows standards so migrating to Open VSX later is zero-change
