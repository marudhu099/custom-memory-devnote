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

    const noteService = new NoteService(this.workspacePath);
    noteService.save(note);
    vscode.window.showInformationMessage(
      'DevNote: Note saved! Use Ctrl+Alt+M to sync to Notion.'
    );
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
