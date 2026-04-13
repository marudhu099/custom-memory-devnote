import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ConfigService } from './ConfigService';
import { DraftStore } from './DraftStore';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devnote.sidebar';

  private view?: vscode.WebviewView;

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

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') {
        this.handleReady();
      }
    });
  }

  // External trigger from Ctrl+Alt+D shortcut — to be implemented in Task 13
  async triggerGenerate(): Promise<void> {
    // Implementation comes in Task 13
  }

  private async handleReady(): Promise<void> {
    // Initial state decision: setup or idle?
    const geminiKey = await this.configService.getGeminiApiKey();
    const notionToken = await this.configService.getNotionToken();
    const notionDbId = this.configService.getNotionDatabaseId();

    if (!geminiKey || !notionToken || !notionDbId) {
      this.postMessage({ type: 'setState', state: 'setup' });
    } else {
      this.postMessage({ type: 'setState', state: 'idle' });
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
