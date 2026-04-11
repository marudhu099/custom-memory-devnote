import * as vscode from 'vscode';

export class ConfigService {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getGeminiApiKey(): Promise<string | undefined> {
    return this.secrets.get('devnote.geminiApiKey');
  }

  async setGeminiApiKey(key: string): Promise<void> {
    await this.secrets.store('devnote.geminiApiKey', key);
  }

  async getNotionToken(): Promise<string | undefined> {
    return this.secrets.get('devnote.notionToken');
  }

  async setNotionToken(token: string): Promise<void> {
    await this.secrets.store('devnote.notionToken', token);
  }

  getNotionDatabaseId(): string {
    const config = vscode.workspace.getConfiguration('devnote');
    return config.get<string>('notionDatabaseId', '');
  }
}
