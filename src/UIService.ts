import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StructuredNote } from './LLMService';

export class UIService {
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  showPreview(note: StructuredNote): Promise<boolean> {
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'devnotePreview',
        `DevNote: ${note.title}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      const htmlPath = path.join(this.extensionPath, 'webview', 'preview.html');
      let html = fs.readFileSync(htmlPath, 'utf-8');
      html = html.replace('{{NOTE_DATA}}', JSON.stringify(note));
      panel.webview.html = html;

      let resolved = false;

      panel.webview.onDidReceiveMessage((message) => {
        if (resolved) {
          return;
        }
        if (message.command === 'approve') {
          resolved = true;
          resolve(true);
          panel.dispose();
        } else if (message.command === 'reject') {
          resolved = true;
          resolve(false);
          panel.dispose();
        }
      });

      panel.onDidDispose(() => {
        if (!resolved) {
          resolve(false);
        }
      });
    });
  }
}
