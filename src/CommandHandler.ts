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

    // Save locally as safety net
    const noteService = new NoteService(this.workspacePath);
    noteService.save(note);

    // Check Notion config
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

    // Structure note for Notion (reuses Gemini key from earlier)
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

    // Check for duplicate title in Notion
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

    // Branch on duplicate / no duplicate
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

    // Duplicate found — ask user what to do
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

  async handleSync(): Promise<void> {
    const noteService = new NoteService(this.workspacePath);
    if (!noteService.exists()) {
      vscode.window.showErrorMessage(
        'DevNote: No note to sync — create one first with Ctrl+Alt+D'
      );
      return;
    }

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

    const noteContent = noteService.read();

    const apiKey = await this.configService.getGeminiApiKey();
    if (!apiKey) {
      vscode.window.showErrorMessage(
        'DevNote: No Gemini API key set — needed to structure note for Notion.'
      );
      return;
    }

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

    const notionService = new NotionService(notionToken, databaseId);
    try {
      const titleMatch = noteContent.match(/^title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : 'DevNote';
      await notionService.push(title, structuredContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Sync failed — ${message}`
      );
      return;
    }

    noteService.delete();
    vscode.window.showInformationMessage('DevNote: Note synced to Notion!');
  }
}
