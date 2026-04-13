import * as vscode from 'vscode';
import { CommandHandler } from './CommandHandler';
import { ConfigService } from './ConfigService';
import { UIService } from './UIService';
import { SidebarProvider } from './SidebarProvider';
import { DraftStore } from './DraftStore';

export function activate(context: vscode.ExtensionContext) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const configService = new ConfigService(context.secrets);
  const draftStore = new DraftStore(context);

  // Register the new sidebar provider (works without a workspace)
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context,
    configService,
    draftStore
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Old command-based flow — kept temporarily during the transition
  if (!workspacePath) {
    return;
  }

  const uiService = new UIService(context.extensionPath);
  const handler = new CommandHandler(configService, uiService, workspacePath);

  const createCommand = vscode.commands.registerCommand('devnote.create', async () => {
    try {
      await handler.handleCreate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DevNote: ${msg}`);
    }
  });

  const syncCommand = vscode.commands.registerCommand('devnote.sync', async () => {
    try {
      await handler.handleSync();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DevNote: ${msg}`);
    }
  });

  const setGeminiKeyCommand = vscode.commands.registerCommand(
    'devnote.setGeminiKey',
    async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Gemini API key',
        placeHolder: 'Paste your API key here',
        password: true,
      });
      if (!key) return;
      await configService.setGeminiApiKey(key);
      vscode.window.showInformationMessage('DevNote: Gemini API key saved.');
    }
  );

  const setNotionTokenCommand = vscode.commands.registerCommand(
    'devnote.setNotionToken',
    async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Notion integration token',
        placeHolder: 'Paste your Notion token here',
        password: true,
      });
      if (!token) return;
      await configService.setNotionToken(token);
      vscode.window.showInformationMessage('DevNote: Notion token saved.');
    }
  );

  context.subscriptions.push(
    createCommand,
    syncCommand,
    setGeminiKeyCommand,
    setNotionTokenCommand
  );
}

export function deactivate() {}
