import * as vscode from 'vscode';
import { CommandHandler } from './CommandHandler';
import { ConfigService } from './ConfigService';
import { UIService } from './UIService';

export function activate(context: vscode.ExtensionContext) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    return;
  }

  const configService = new ConfigService(context.secrets);
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

      if (!key) {
        return;
      }

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

      if (!token) {
        return;
      }

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
