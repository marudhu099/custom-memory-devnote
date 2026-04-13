import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_FALLBACK_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const RETRIABLE_ERROR_PATTERN = /503|overloaded|high demand|unavailable/i;

export interface NotePayload {
  branchDiff: string;
  filesChanged: string[];
  commitCount: number;
  title: string;
  userNotes?: string;
  uncommittedStaged?: string;
  uncommittedUnstaged?: string;
}

export interface StructuredNote {
  title: string;
  summary: string;
  whatChanged: string[];
  why: string;
  filesAffected: string[];
  keyDecisions: string;
  timestamp: string;
}

export interface LLMService {
  generateNote(payload: NotePayload): Promise<StructuredNote>;
  structureForNotion(noteContent: string): Promise<string>;
}

export class GeminiLLMService implements LLMService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async callWithFallback(prompt: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    let lastError: unknown;

    for (const modelName of MODEL_FALLBACK_CHAIN) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!RETRIABLE_ERROR_PATTERN.test(message)) {
          throw err;
        }
      }
    }

    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    if (RETRIABLE_ERROR_PATTERN.test(errMsg)) {
      throw new Error('Gemini is temporarily overloaded. Please try again in a minute.');
    }
    throw lastError instanceof Error ? lastError : new Error(errMsg);
  }

  async generateNote(payload: NotePayload): Promise<StructuredNote> {
    let uncommittedSection = '';
    if (payload.uncommittedStaged || payload.uncommittedUnstaged) {
      uncommittedSection = `

Uncommitted staged changes:
${payload.uncommittedStaged || '(none)'}

Uncommitted unstaged changes:
${payload.uncommittedUnstaged || '(none)'}`;
    }

    const prompt = `You are a developer documentation assistant. Analyze the following git diff from a feature branch and generate a structured developer note. This diff represents the entire branch compared to main (${payload.commitCount} commit(s)).

Title: ${payload.title}
${payload.userNotes ? `Developer notes: ${payload.userNotes}` : ''}

Files changed: ${payload.filesChanged.join(', ')}

Branch diff (all changes vs main):
${payload.branchDiff || '(none)'}${uncommittedSection}

Respond in this exact JSON format (no markdown fences, just raw JSON):
{
  "title": "the title",
  "summary": "one-line summary of what was done",
  "whatChanged": ["change 1", "change 2"],
  "why": "why these changes were made",
  "filesAffected": ["file1.ts", "file2.ts"],
  "keyDecisions": "any notable design decisions made",
  "timestamp": "${new Date().toISOString()}"
}`;

    const text = await this.callWithFallback(prompt);

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed: StructuredNote = JSON.parse(cleaned);
    return parsed;
  }

  async structureForNotion(noteContent: string): Promise<string> {
    const prompt = `Convert the following developer note into a clean, readable format suitable for a Notion page. Return plain text with markdown headings and bullet points. Keep it concise and well-structured.

${noteContent}`;

    return this.callWithFallback(prompt);
  }
}
