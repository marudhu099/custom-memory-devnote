import * as vscode from 'vscode';
import { StructuredNote } from './LLMService';

export interface DraftData {
  title: string;
  description?: string;
  generatedNote: StructuredNote;
  structuredContent?: string;
  lastError: string;
  createdAt: number;
  branchName: string;
}

const STORAGE_KEY = 'devnote.draft';

export class DraftStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get(): DraftData | null {
    const raw = this.context.globalState.get<DraftData>(STORAGE_KEY);
    return raw ?? null;
  }

  exists(): boolean {
    return this.get() !== null;
  }

  async save(draft: DraftData): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, draft);
  }

  async clear(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, undefined);
  }
}
