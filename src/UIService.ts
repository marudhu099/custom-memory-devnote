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

      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === 'approve') {
          panel.dispose();
          resolve(true);
        } else if (message.command === 'reject') {
          panel.dispose();
          resolve(false);
        }
      });

      panel.onDidDispose(() => {
        resolve(false);
      });
    });
  }
}
