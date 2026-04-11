import * as vscode from 'vscode';
import { GitService } from './GitService';
import { ConfigService } from './ConfigService';
import { GeminiLLMService } from './LLMService';
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
    // 1. Check git availability
    const gitService = new GitService(this.workspacePath);
    const availability = await gitService.checkAvailability();
    if (!availability.available) {
      vscode.window.showErrorMessage(`DevNote: ${availability.reason}`);
      return;
    }

    // 2. Get API key
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

    // 3. Get diff
    const diff = await gitService.getDiff();

    // 4. Get user input
    const title = await vscode.window.showInputBox({
      prompt: 'Dev note title',
      placeHolder: 'What did you work on?',
    });
    if (!title) {
      return; // User cancelled
    }

    const userNotes = await vscode.window.showInputBox({
      prompt: 'Any additional notes? (optional — press Enter to skip)',
      placeHolder: 'Context, decisions, things to remember...',
    });

    // 5. Generate note via LLM
    const llmService = new GeminiLLMService(apiKey);
    let note;
    try {
      note = await llmService.generateNote({
        staged: diff.staged,
        unstaged: diff.unstaged,
        filesChanged: diff.filesChanged,
        title,
        userNotes: userNotes || undefined,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Failed to generate note — ${message}`
      );
      return;
    }

    // 6. Preview
    const approved = await this.uiService.showPreview(note);
    if (!approved) {
      vscode.window.showInformationMessage('DevNote: Note discarded.');
      return;
    }

    // 7. Save locally
    const noteService = new NoteService(this.workspacePath);
    noteService.save(note);
    vscode.window.showInformationMessage(
      'DevNote: Note saved! Use Ctrl+Alt+M to sync to Notion.'
    );
  }

  async handleSync(): Promise<void> {
    // 1. Check if note exists
    const noteService = new NoteService(this.workspacePath);
    if (!noteService.exists()) {
      vscode.window.showErrorMessage(
        'DevNote: No note to sync — create one first with Ctrl+Alt+D'
      );
      return;
    }

    // 2. Check Notion config
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

    // 3. Read note
    const noteContent = noteService.read();

    // 4. Get API key for LLM structuring
    const apiKey = await this.configService.getGeminiApiKey();
    if (!apiKey) {
      vscode.window.showErrorMessage(
        'DevNote: No Gemini API key set — needed to structure note for Notion.'
      );
      return;
    }

    // 5. Structure for Notion via LLM
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

    // 6. Push to Notion
    const notionService = new NotionService(notionToken, databaseId);
    try {
      // Extract title from frontmatter
      const titleMatch = noteContent.match(/^title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : 'DevNote';
      await notionService.push(title, structuredContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `DevNote: Sync failed — ${message}`
      );
      return; // Do NOT delete local file
    }

    // 7. Delete local file only after successful sync
    noteService.delete();
    vscode.window.showInformationMessage('DevNote: Note synced to Notion!');
  }
}
