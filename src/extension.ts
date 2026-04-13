import * as vscode from 'vscode';
import { ConfigService } from './ConfigService';
import { SidebarProvider } from './SidebarProvider';
import { DraftStore } from './DraftStore';

export function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigService(context.secrets);
  const draftStore = new DraftStore(context);

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

  // Single remaining command: opens the sidebar and auto-triggers generate
  context.subscriptions.push(
    vscode.commands.registerCommand('devnote.create', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devnote-sidebar');
      await sidebarProvider.triggerGenerate();
    })
  );
}

export function deactivate() {}
