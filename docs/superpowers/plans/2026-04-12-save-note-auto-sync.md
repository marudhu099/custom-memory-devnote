# Save Note Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Save Note" in the preview panel auto-sync to Notion with duplicate title detection, while keeping `Ctrl+Alt+M` as a retry command.

**Architecture:** Extend `NotionService` with three new methods for title lookup and block-level page updates. Extend `CommandHandler.handleCreate` to orchestrate the new flow: save locally, check for duplicate, prompt user via Quick Pick if duplicate found, push to Notion, delete local file on success. Existing `handleSync` method stays unchanged for retry scenarios.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.window.showQuickPick`), Notion REST API via native `fetch`, `@google/generative-ai` (existing — used for `structureForNotion`).

**Execution Mode:** Subagent-Driven Development.

---

## File Map

| File | Responsibility | Created/Modified |
|---|---|---|
| `src/NotionService.ts` | Add 3 new methods: `findPageByTitle`, `appendBlocksToPage`, `replacePageBlocks` | Modify |
| `src/CommandHandler.ts` | Extend `handleCreate` with auto-sync + duplicate popup logic | Modify |

**No changes to:** `GitService`, `LLMService`, `ConfigService`, `NoteService`, `UIService`, `extension.ts`, `package.json`, `webview/preview.html`.

---

## Task 1: Add `findPageByTitle` to NotionService

**Files:**
- Modify: `src/NotionService.ts`

**What this method does:** Queries the Notion database for a page whose title matches the given string. Returns the `pageId` if found, `null` if not. Uses Notion's `POST /v1/databases/{databaseId}/query` endpoint with a title filter.

**Notion API detail:** The database schema uses a title property (often named "Name" but could be anything). To filter by title regardless of property name, we query all pages and match on the first title property locally. For MVP simplicity, we assume the property is named "Name" (which is Notion's default and what our existing `push()` uses). If users rename it, we'll handle that in Phase 2.

- [ ] **Step 1: Add `findPageByTitle` method to NotionService**

Add this method to `src/NotionService.ts` right after the existing `push` method (before `markdownToBlocks`):

```typescript
  async findPageByTitle(title: string): Promise<string | null> {
    const body = {
      filter: {
        property: 'Name',
        title: {
          equals: title,
        },
      },
      page_size: 1,
    };

    const response = await fetch(
      `https://api.notion.com/v1/databases/${this.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { results: Array<{ id: string }> };
    if (data.results.length === 0) {
      return null;
    }

    return data.results[0].id;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/NotionService.ts
git commit -m "feat: add findPageByTitle to NotionService for duplicate detection"
```

---

## Task 2: Add `appendBlocksToPage` to NotionService

**Files:**
- Modify: `src/NotionService.ts`

**What this method does:** Appends new blocks (converted from markdown content) to the end of an existing Notion page. Uses `PATCH /v1/blocks/{pageId}/children` — Notion's endpoint for adding children to a block (a page is a block in Notion's model).

- [ ] **Step 1: Add `appendBlocksToPage` method to NotionService**

Add this method to `src/NotionService.ts` right after the `findPageByTitle` method from Task 1:

```typescript
  async appendBlocksToPage(pageId: string, content: string): Promise<void> {
    const body = {
      children: this.markdownToBlocks(content),
    };

    const response = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/NotionService.ts
git commit -m "feat: add appendBlocksToPage to NotionService"
```

---

## Task 3: Add `replacePageBlocks` to NotionService

**Files:**
- Modify: `src/NotionService.ts`

**What this method does:** Replaces all content in an existing page while preserving the page ID. Three-step operation:
1. `GET /v1/blocks/{pageId}/children` — list all existing child block IDs
2. `DELETE /v1/blocks/{blockId}` for each existing block
3. `PATCH /v1/blocks/{pageId}/children` — add new blocks (reuses the append logic)

The page ID (and therefore the URL) stays stable — only the content inside changes.

- [ ] **Step 1: Add `replacePageBlocks` method to NotionService**

Add this method to `src/NotionService.ts` right after the `appendBlocksToPage` method from Task 2:

```typescript
  async replacePageBlocks(pageId: string, content: string): Promise<void> {
    // Step 1: List existing block IDs
    const listResponse = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': '2022-06-28',
        },
      }
    );

    if (!listResponse.ok) {
      const error = await listResponse.text();
      throw new Error(
        `Notion API error listing blocks (${listResponse.status}): ${error}`
      );
    }

    const listData = (await listResponse.json()) as {
      results: Array<{ id: string }>;
    };

    // Step 2: Delete each existing block
    for (const block of listData.results) {
      const deleteResponse = await fetch(
        `https://api.notion.com/v1/blocks/${block.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Notion-Version': '2022-06-28',
          },
        }
      );

      if (!deleteResponse.ok) {
        const error = await deleteResponse.text();
        throw new Error(
          `Notion API error deleting block (${deleteResponse.status}): ${error}`
        );
      }
    }

    // Step 3: Append new blocks (reuses existing method)
    await this.appendBlocksToPage(pageId, content);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/NotionService.ts
git commit -m "feat: add replacePageBlocks to NotionService for duplicate replace flow"
```

---

## Task 4: Extend `CommandHandler.handleCreate` with auto-sync flow

**Files:**
- Modify: `src/CommandHandler.ts`

**What this task does:** After the user clicks "Save Note" in the preview panel, the existing `handleCreate` method currently stops at `noteService.save(note)` and tells the user to run `Ctrl+Alt+M`. This task extends it to:

1. Still save locally (safety net)
2. Check Notion token + database ID + Gemini key
3. Call `structureForNotion` on the saved note content
4. Call `findPageByTitle` to check for duplicates
5. If no duplicate → push new page
6. If duplicate → show Quick Pick → Append/Replace/Cancel
7. Delete local file only on successful Notion operation
8. Handle all errors by keeping local file and telling user to retry with `Ctrl+Alt+M`

The `handleSync` method (manual retry command bound to `Ctrl+Alt+M`) stays unchanged.

- [ ] **Step 1: Replace `handleCreate` method with extended version**

In `src/CommandHandler.ts`, find the existing `handleCreate` method (starts around line 20 with `async handleCreate(): Promise<void>`). Replace it and add a new private helper `showDuplicateChoicePopup`.

Replace the ENTIRE `handleCreate` method with this:

```typescript
  async handleCreate(): Promise<void> {
    const gitService = new GitService(this.workspacePath);
    const availability = await gitService.checkAvailability();
    if (!availability.available) {
      vscode.window.showErrorMessage(`DevNote: ${availability.reason}`);
      return;
    }

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

    const onBase = await gitService.isOnBaseBranch();
    let payload: NotePayload;

    if (onBase) {
      const uncommitted = await gitService.getUncommittedDiff();
      payload = {
        branchDiff: '',
        filesChanged: uncommitted.filesChanged,
        commitCount: 0,
        title: '',
        uncommittedStaged: uncommitted.staged,
        uncommittedUnstaged: uncommitted.unstaged,
      };
    } else {
      const branchDiff = await gitService.getBranchDiff();
      payload = {
        branchDiff: branchDiff.branchDiff,
        filesChanged: branchDiff.filesChanged,
        commitCount: branchDiff.commitCount,
        title: '',
      };

      const uncommitted = await gitService.getUncommittedDiff();
      if (uncommitted.staged || uncommitted.unstaged) {
        payload.uncommittedStaged = uncommitted.staged;
        payload.uncommittedUnstaged = uncommitted.unstaged;

        const allFiles = new Set([...payload.filesChanged, ...uncommitted.filesChanged]);
        payload.filesChanged = [...allFiles];
      }
    }

    const title = await vscode.window.showInputBox({
      prompt: 'Dev note title',
      placeHolder: 'What did you work on?',
    });
    if (!title) {
      return;
    }
    payload.title = title;

    const userNotes = await vscode.window.showInputBox({
      prompt: 'Any additional notes? (optional — press Enter to skip)',
      placeHolder: 'Context, decisions, things to remember...',
    });
    payload.userNotes = userNotes || undefined;

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

    const approved = await this.uiService.showPreview(note);
    if (!approved) {
      vscode.window.showInformationMessage('DevNote: Note discarded.');
      return;
    }

    // Step 7: Save locally as safety net
    const noteService = new NoteService(this.workspacePath);
    noteService.save(note);

    // Step 8: Check Notion config
    const notionToken = await this.configService.getNotionToken();
    if (!notionToken) {
      vscode.window.showWarningMessage(
        'DevNote: Note saved locally. Set Notion token with "DevNote: Set Notion Token" to enable sync.'
      );
      return;
    }

    const databaseId = this.configService.getNotionDatabaseId();
    if (!databaseId) {
      vscode.window.showWarningMessage(
        'DevNote: Note saved locally. Set "devnote.notionDatabaseId" in settings to enable sync.'
      );
      return;
    }

    // Step 9: Structure note for Notion (reuses Gemini key from earlier)
    const noteContent = noteService.read();
    let structuredContent: string;
    try {
      structuredContent = await llmService.structureForNotion(noteContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Note saved locally. Failed to structure for Notion — ${message}. Please try again with Ctrl+Alt+M.`
      );
      return;
    }

    // Step 10: Check for duplicate title in Notion
    const notionService = new NotionService(notionToken, databaseId);
    let existingPageId: string | null;
    try {
      existingPageId = await notionService.findPageByTitle(title);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Failed to check for duplicate titles — ${message}. Your note is saved locally. Please try again with Ctrl+Alt+M.`
      );
      return;
    }

    // Step 11: Branch on duplicate / no duplicate
    if (existingPageId === null) {
      // No duplicate — create new page
      try {
        await notionService.push(title, structuredContent);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(
          `DevNote: Failed to create Notion page — ${message}. Your note is saved locally. Please try again with Ctrl+Alt+M.`
        );
        return;
      }

      noteService.delete();
      vscode.window.showInformationMessage(
        'DevNote: Note synced to Notion as a new page.'
      );
      return;
    }

    // Step 12: Duplicate found — ask user what to do
    const choice = await this.showDuplicateChoicePopup(title);

    if (choice === 'cancel' || choice === undefined) {
      vscode.window.showInformationMessage(
        'DevNote: Sync cancelled. Your note is saved locally — use Ctrl+Alt+M to sync later.'
      );
      return;
    }

    if (choice === 'append') {
      try {
        await notionService.appendBlocksToPage(existingPageId, structuredContent);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(
          `DevNote: Failed to append to existing Notion page — ${message}. Your note is saved locally. Please try again with Ctrl+Alt+M.`
        );
        return;
      }

      noteService.delete();
      vscode.window.showInformationMessage(
        `DevNote: Note appended to existing Notion page "${title}".`
      );
      return;
    }

    if (choice === 'replace') {
      try {
        await notionService.replacePageBlocks(existingPageId, structuredContent);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(
          `DevNote: Failed to replace Notion page content — ${message}. Your note is saved locally. Please try again with Ctrl+Alt+M.`
        );
        return;
      }

      noteService.delete();
      vscode.window.showInformationMessage(
        `DevNote: Notion page "${title}" replaced with new content.`
      );
      return;
    }
  }

  private async showDuplicateChoicePopup(title: string): Promise<'append' | 'replace' | 'cancel' | undefined> {
    type PopupItem = vscode.QuickPickItem & { value: 'append' | 'replace' | 'cancel' };

    const items: PopupItem[] = [
      {
        label: '$(add) Append',
        description: 'Add new content below the existing page',
        detail: 'Keeps history — old content is preserved, new content is added at the bottom',
        value: 'append',
      },
      {
        label: '$(replace-all) Replace',
        description: 'Delete old content and replace with new',
        detail: 'Keeps the same page URL, but old content is removed',
        value: 'replace',
      },
      {
        label: '$(close) Cancel',
        description: 'Abort sync and keep the local file',
        detail: 'You can retry later with Ctrl+Alt+M',
        value: 'cancel',
      },
    ];

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: `A page titled "${title}" already exists in Notion. What should we do?`,
      ignoreFocusOut: true,
    });

    return selection?.value;
  }
```

**Important:** Do NOT modify the `handleSync` method. It stays exactly as it is — users still need it for manual retries.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p ./ --noEmit`
Expected: No errors

- [ ] **Step 3: Verify handleSync is unchanged**

Run: `grep -n "async handleSync" src/CommandHandler.ts`
Expected: One match — `async handleSync(): Promise<void> {`

Then eyeball the method to confirm it still reads the local file, structures it, pushes to Notion, and deletes on success.

- [ ] **Step 4: Commit**

```bash
git add src/CommandHandler.ts
git commit -m "feat: auto-sync to Notion after Save Note with duplicate title handling"
```

---

## Task 5: Manual E2E testing

**Files:**
- No file changes — verification only

**What this task does:** Runs the full flow through the VS Code Extension Development Host to verify all scenarios from the spec.

- [ ] **Step 1: Compile and launch Extension Development Host**

Run: `npx tsc -p ./`
Expected: Compiles clean, `out/` populated

Then press `F5` in VS Code with the devnote project open. A second window (Extension Development Host) opens.

- [ ] **Step 2: Test — Happy path with new title**

In the Extension Development Host, open a git repo with some changes (the BunnyDesk project works). Press `Ctrl+Alt+D`.

1. Enter a unique title like "Test new title flow"
2. Skip the optional notes
3. Wait for preview panel to open
4. Click "Save Note"

Expected:
- Notification: `DevNote: Note synced to Notion as a new page.`
- `custom_memory_note.md` does NOT exist in the workspace (deleted)
- New page appears in your Notion database with the title "Test new title flow"

- [ ] **Step 3: Test — Happy path with Append**

Press `Ctrl+Alt+D` again with the SAME title: "Test new title flow"

1. Enter title "Test new title flow"
2. Skip optional notes
3. Click "Save Note" in preview
4. Quick Pick popup appears — select **Append**

Expected:
- Notification: `DevNote: Note appended to existing Notion page "Test new title flow".`
- `custom_memory_note.md` deleted
- In Notion, the existing page now has BOTH the original content AND the new blocks below it

- [ ] **Step 4: Test — Happy path with Replace**

Press `Ctrl+Alt+D` again with the same title: "Test new title flow"

1. Enter title "Test new title flow"
2. Skip optional notes
3. Click "Save Note" in preview
4. Quick Pick popup appears — select **Replace**

Expected:
- Notification: `DevNote: Notion page "Test new title flow" replaced with new content.`
- `custom_memory_note.md` deleted
- In Notion, the page URL is unchanged (same page ID) but the old content is gone, replaced with only the new blocks

- [ ] **Step 5: Test — Cancel flow**

Press `Ctrl+Alt+D` with the same title again.

1. Enter title "Test new title flow"
2. Click "Save Note"
3. When Quick Pick opens, select **Cancel** (or press Escape)

Expected:
- Notification: `DevNote: Sync cancelled. Your note is saved locally — use Ctrl+Alt+M to sync later.`
- `custom_memory_note.md` EXISTS in the workspace (still present)
- Notion database is unchanged (no new page, existing page untouched)

- [ ] **Step 6: Test — Ctrl+Alt+M retry after Cancel**

Without pressing Ctrl+Alt+D, press `Ctrl+Alt+M`.

Expected:
- The existing `handleSync` method runs
- It reads the local file, pushes to Notion as a brand new page (handleSync doesn't do duplicate detection, that's intentional — it's the retry/manual path)
- Local file deleted
- Success notification from handleSync

This confirms Ctrl+Alt+M still works and gives users an escape hatch.

- [ ] **Step 7: Test — Missing Notion token**

Delete the Notion token:

1. `Ctrl+Shift+P` → `DevNote: Set Notion Token`
2. Clear the input and press Enter (or just cancel)

Actually, there's no way to clear SecretStorage via command. Instead:
- Open VS Code command palette
- Search for "DevNote: Set Notion Token"
- Enter a garbage value like `invalid_token_for_test`
- Then press `Ctrl+Alt+D` and click Save Note

Expected:
- Error: `DevNote: Failed to check for duplicate titles — Notion API error (401): ...`
- Local file stays
- Notion unchanged

After testing, reset the Notion token to the real value.

- [ ] **Step 8: Verify working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

No commits in this task — it's verification only.

- [ ] **Step 9: If everything passes, mark task complete**

The branch is ready to PR and merge.
