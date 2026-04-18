import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ConfigService } from './ConfigService';
import { DraftStore } from './DraftStore';
import { GitService } from './GitService';
import { GeminiLLMService, NotePayload, StructuredNote } from './LLMService';
import { MemoryStore } from './MemoryStore';
import { NotionService } from './NotionService';
import { SearchService } from './SearchService';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devnote.sidebar';

  private view?: vscode.WebviewView;
  private pendingFormData: { title: string; description?: string } | null = null;
  private currentNote: StructuredNote | null = null;
  private generateAbortController: AbortController | null = null;
  private syncAbortController: AbortController | null = null;
  private currentDuplicatePageId: string | null = null;
  private cachedStructuredContent: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly configService: ConfigService,
    private readonly draftStore: DraftStore,
    private readonly memoryStore: MemoryStore,
    private readonly getSearchService: () => SearchService | null,
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
          case 'clickRetry':
            await this.handleClickRetry(msg.kind);
            break;
          case 'clickDiscard':
            await this.handleClickDiscard();
            break;
          case 'clickSaveNote':
            await this.handleClickSaveNote();
            break;
          case 'clickDuplicateChoice':
            await this.handleDuplicateChoice(msg.choice);
            break;
          case 'clickRetryDraft':
            await this.handleRetryDraft();
            break;
          case 'clickDiscardDraft':
            await this.handleDiscardDraft();
            break;
          case 'openSettings':
            await this.handleOpenSettings();
            break;
          case 'clickRecentNote':
            await this.handleClickRecentNote(msg.id);
            break;
          case 'clickClearMemory':
            await this.handleClearMemory(msg.exportFirst);
            break;
          case 'searchQuery':
            await this.handleSearchQuery(msg.query);
            break;
          case 'clearSearch':
            await this.refreshIdleState();
            break;
          case 'clickResetPythonEnv':
            await this.handleResetPythonEnv();
            break;
          case 'clickReindexAll':
            await this.handleReindexAll();
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`DevNote: ${message}`);
      }
    });

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
  }

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

  private async handleSaveSetup(geminiKey: string, notionToken: string, notionDbId: string): Promise<void> {
    await this.configService.setGeminiApiKey(geminiKey);
    await this.configService.setNotionToken(notionToken);

    const config = vscode.workspace.getConfiguration('devnote');
    await config.update('notionDatabaseId', notionDbId, vscode.ConfigurationTarget.Global);

    // Update SearchService's API key if it already exists; otherwise it'll be created
    // lazily on first activation-post-config by extension.ts' activation logic.
    const searchService = this.getSearchService();
    if (searchService) {
      await searchService.updateApiKey(geminiKey);
    }

    this.postMessage({ type: 'setState', state: 'idle' });
  }

  private getWorkspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async refreshIdleState(): Promise<void> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      this.postMessage({ type: 'setBranchInfo', branch: '—', canGenerate: false, reason: 'Not a git repository.' });
      this.postMessage({ type: 'setState', state: 'idle' });
      await this.sendRecentNotes();
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
        await this.sendRecentNotes();
        return;
      }

      const branchName = await this.tryGetBranchName(gitService);
      this.postMessage({ type: 'setBranchInfo', branch: branchName, canGenerate: true });
      this.postMessage({ type: 'setState', state: 'idle' });
      await this.sendRecentNotes();
    } catch (err) {
      this.postMessage({ type: 'setBranchInfo', branch: '—', canGenerate: false, reason: 'Not a git repository.' });
      this.postMessage({ type: 'setState', state: 'idle' });
      await this.sendRecentNotes();
    }
  }

  private async sendRecentNotes(): Promise<void> {
    try {
      const recentNotes = await this.memoryStore.getRecentNotes();
      this.postMessage({ type: 'setRecentNotes', notes: recentNotes });
    } catch {
      this.postMessage({ type: 'setRecentNotes', notes: [] });
    }
  }

  private async tryGetBranchName(gitService: GitService): Promise<string> {
    try {
      return await gitService.getCurrentBranch();
    } catch {
      return '—';
    }
  }

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
      const detail = err instanceof Error ? err.message : String(err);
      this.postMessage({
        type: 'setState',
        state: 'generate-error',
        data: { message: `Couldn't generate note: ${detail}` },
      });
    }
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
    } else if (from === 'setup') {
      // Setup → wherever handleReady decides (idle if configured, stays in setup otherwise).
      await this.handleReady();
    } else if (from === 'historical-preview') {
      // Historical preview → Idle. Clear preview state.
      this.currentNote = null;
      await this.refreshIdleState();
    } else if (from === 'success') {
      // Success → Idle. Clear note state and return to a fresh idle screen.
      this.currentNote = null;
      this.pendingFormData = null;
      this.currentDuplicatePageId = null;
      this.cachedStructuredContent = null;
      await this.refreshIdleState();
    }
  }

  private async handleClickRetry(kind: 'generate' | 'sync'): Promise<void> {
    if (kind === 'generate' && this.pendingFormData) {
      await this.handleSubmitForm(this.pendingFormData.title, this.pendingFormData.description);
    } else if (kind === 'sync') {
      await this.handleClickSaveNote();
    }
  }

  private async handleClickDiscard(): Promise<void> {
    this.currentNote = null;
    this.pendingFormData = null;
    await this.refreshIdleState();
  }

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

    this.postMessage({ type: 'setState', state: 'syncing' });
    this.postMessage({ type: 'setLoadingText', text: 'Checking Notion...' });
    this.syncAbortController = new AbortController();

    try {
      // Build the Notion content locally from the structured note — no extra LLM call needed.
      const structuredContent = this.serializeNoteToMarkdown(this.currentNote);

      // Step 1: Check for duplicate
      const notionService = new NotionService(notionToken, databaseId);
      const existingPageId = await notionService.findPageByTitle(this.pendingFormData.title);
      if (this.syncAbortController?.signal.aborted) return;

      if (existingPageId !== null) {
        this.currentDuplicatePageId = existingPageId;
        this.cachedStructuredContent = structuredContent;
        this.postMessage({
          type: 'setState',
          state: 'duplicate',
          data: { title: this.pendingFormData.title },
        });
        return;
      }

      // Step 2: Push new page
      this.postMessage({ type: 'setLoadingText', text: 'Syncing to Notion...' });
      const { pageId: notionPageId, pageUrl: notionPageUrl } = await notionService.push(this.pendingFormData.title, structuredContent);
      if (this.syncAbortController?.signal.aborted) return;

      // Success — stays on the success state until the user clicks "Back to Generate Doc".
      await this.draftStore.clear();

      // Save to local memory (best-effort — Notion is authoritative)
      await this.saveNoteToMemory(notionPageId, notionPageUrl);

      this.postMessage({
        type: 'setState',
        state: 'success',
        data: { message: 'You got it! Note synced to Notion.' },
      });
    } catch (err) {
      if (this.syncAbortController?.signal.aborted) return;
      const detail = err instanceof Error ? err.message : String(err);
      const friendly = `Couldn't sync to Notion: ${detail}`;
      await this.saveCurrentAsDraft(friendly);
      this.postMessage({
        type: 'setState',
        state: 'sync-error',
        data: { message: friendly },
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

      // Save to local memory (best-effort)
      const notionPageUrl = `https://www.notion.so/${this.currentDuplicatePageId!.replace(/-/g, '')}`;
      await this.saveNoteToMemory(this.currentDuplicatePageId!, notionPageUrl);

      const successMessage = choice === 'append'
        ? `Note appended to existing Notion page "${this.pendingFormData.title}".`
        : `Notion page "${this.pendingFormData.title}" replaced with new content.`;

      this.postMessage({
        type: 'setState',
        state: 'success',
        data: { message: successMessage },
      });
      // Stays on success state until the user clicks "Back to Generate Doc".
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const friendlyMessage = choice === 'append'
        ? `Couldn't add to existing Notion page: ${detail}`
        : `Couldn't replace Notion page content: ${detail}`;
      await this.saveCurrentAsDraft(friendlyMessage);
      this.postMessage({
        type: 'setState',
        state: 'sync-error',
        data: { message: friendlyMessage },
      });
    }
  }

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

  private async saveNoteToMemory(notionPageId: string, notionPageUrl: string): Promise<void> {
    if (!this.currentNote) return;
    try {
      const workspacePath = this.getWorkspacePath();
      let branchName = '—';
      if (workspacePath) {
        branchName = await this.tryGetBranchName(new GitService(workspacePath));
      }
      const savedId = await this.memoryStore.saveNote(this.currentNote, {
        title: this.pendingFormData?.title ?? this.currentNote.title,
        branchName,
        notionPageId,
        notionPageUrl,
      });

      // Best-effort embed for v0.4.0 search (fails silently → backfill catches later)
      const searchService = this.getSearchService();
      if (searchService) {
        const contentMarkdown = this.serializeNoteToMarkdown(this.currentNote);
        void searchService.embedNote(savedId, contentMarkdown).then((ok) => {
          if (!ok) {
            vscode.window.showInformationMessage(
              'Note synced. Search indexing will happen on your next search.'
            );
          }
        });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `Note synced to Notion, but DevNote couldn't save it locally. It won't appear in Recent Notes. (${detail})`
      );
    }
  }

  private async handleClickRecentNote(id: string): Promise<void> {
    try {
      const note = await this.memoryStore.getNoteById(id);
      if (!note) {
        vscode.window.showWarningMessage('This note is no longer in memory.');
        await this.refreshIdleState();
        return;
      }
      this.postMessage({
        type: 'setState',
        state: 'preview',
        data: {
          note: note.content,
          isHistorical: true,
          notionPageUrl: note.notionPageUrl,
        },
      });
    } catch {
      vscode.window.showWarningMessage('Couldn\'t load this note from memory.');
      await this.refreshIdleState();
    }
  }

  private async handleSearchQuery(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) {
      await this.refreshIdleState();
      return;
    }

    const searchService = this.getSearchService();
    if (!searchService) {
      this.postMessage({
        type: 'setSearchResults',
        query: trimmed,
        results: [],
        error: 'Search unavailable — configure Gemini API key first.',
      });
      return;
    }

    // Show loading state
    this.postMessage({ type: 'setSearchLoading', query: trimmed });

    try {
      await searchService.ensureReady();
      const raw = await searchService.searchQuery(trimmed);
      // Hydrate full metadata
      const results = [];
      for (const r of raw) {
        const note = await this.memoryStore.getNoteById(r.id);
        if (note) {
          results.push({
            id: note.id,
            title: note.title,
            branchName: note.branchName,
            createdAt: note.createdAt,
            score: r.score,
          });
        }
      }
      this.postMessage({ type: 'setSearchResults', query: trimmed, results });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.postMessage({
        type: 'setSearchResults',
        query: trimmed,
        results: [],
        error: detail,
      });
    }
  }

  private async handleResetPythonEnv(): Promise<void> {
    const searchService = this.getSearchService();
    if (!searchService) return;

    const confirm = await vscode.window.showWarningMessage(
      'Reset DevNote\'s Python environment? It will be set up again on your next search.',
      { modal: true },
      'Reset'
    );
    if (confirm !== 'Reset') return;

    try {
      await searchService.resetEnvironment();
      vscode.window.showInformationMessage('Python environment reset.');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Couldn't reset: ${detail}`);
    }
  }

  private async handleReindexAll(): Promise<void> {
    const searchService = this.getSearchService();
    if (!searchService) return;

    const confirm = await vscode.window.showWarningMessage(
      'Re-index all your notes for search? All current embeddings will be cleared and regenerated on your next search.',
      { modal: true },
      'Re-index all'
    );
    if (confirm !== 'Re-index all') return;

    try {
      await searchService.reindexAll();
      vscode.window.showInformationMessage('All notes re-indexed. Next search will regenerate embeddings.');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Couldn't re-index: ${detail}`);
    }
  }

  private async handleClearMemory(exportFirst: boolean): Promise<void> {
    try {
      if (exportFirst) {
        const json = await this.memoryStore.exportAll();
        const defaultUri = vscode.Uri.file(
          `devnote-backup-${new Date().toISOString().slice(0, 10)}.json`
        );
        const uri = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { 'JSON files': ['json'] },
        });
        if (!uri) {
          // User cancelled the save dialog — abort, nothing deleted
          return;
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
      }

      await this.memoryStore.clearAll();
      vscode.window.showInformationMessage('Memory cleared. Your Notion pages are untouched.');
      await this.refreshIdleState();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (exportFirst) {
        vscode.window.showErrorMessage(`Couldn't create backup. Memory was NOT cleared. (${detail})`);
      } else {
        vscode.window.showErrorMessage(`Couldn't clear memory. Please try again. (${detail})`);
      }
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
