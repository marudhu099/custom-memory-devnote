import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ConfigService } from './ConfigService';
import { DraftStore } from './DraftStore';
import { GitService } from './GitService';
import { GeminiLLMService, NotePayload, StructuredNote } from './LLMService';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devnote.sidebar';

  private view?: vscode.WebviewView;
  private pendingFormData: { title: string; description?: string } | null = null;
  private currentNote: StructuredNote | null = null;
  private generateAbortController: AbortController | null = null;

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
      this.currentNote = null;
      this.pendingFormData = null;
    });
  }

  // External trigger from Ctrl+Alt+D shortcut — to be implemented in Task 13
  async triggerGenerate(): Promise<void> {
    // Implementation comes in Task 13
  }

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

  private async handleSaveSetup(geminiKey: string, notionToken: string, notionDbId: string): Promise<void> {
    await this.configService.setGeminiApiKey(geminiKey);
    await this.configService.setNotionToken(notionToken);

    const config = vscode.workspace.getConfiguration('devnote');
    await config.update('notionDatabaseId', notionDbId, vscode.ConfigurationTarget.Global);

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
      this.postMessage({
        type: 'setState',
        state: 'generate-error',
        data: { message: 'Couldn\'t generate note. Please try again.' },
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
    }
  }

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
