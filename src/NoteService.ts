import * as fs from 'fs';
import * as path from 'path';

import type { StructuredNote } from './LLMService';

export class NoteService {
  constructor(private readonly workspacePath: string) {}

  private getFilePath(): string {
    return path.join(this.workspacePath, 'custom_memory_note.md');
  }

  exists(): boolean {
    return fs.existsSync(this.getFilePath());
  }

  save(note: StructuredNote): void {
    const content = `---
title: ${note.title}
timestamp: ${note.timestamp}
files:
${note.filesAffected.map((file) => `  - ${file}`).join('\n')}
---

## Summary
${note.summary}

## What Changed
${note.whatChanged.map((change) => `- ${change}`).join('\n')}

## Why
${note.why}

## Key Decisions
${note.keyDecisions}
`;

    fs.writeFileSync(this.getFilePath(), content, 'utf8');
  }

  read(): string {
    return fs.readFileSync(this.getFilePath(), 'utf8');
  }

  delete(): void {
    fs.unlinkSync(this.getFilePath());
  }
}
