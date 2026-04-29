import { SearchService } from './SearchService';
import { MemoryStore, FullNote } from './MemoryStore';
import { PythonBridge } from './PythonBridge';

const HISTORY_TURNS_TO_INCLUDE = 4;
const RETRIEVED_NOTES_K = 5;

export interface CitationRef {
  noteNumber: number;
  noteId: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  citations?: CitationRef[];
}

export interface ChatStreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (finalText: string, citations: CitationRef[]) => void;
  onError: (err: Error) => void;
}

export class ChatService {
  private history: ChatTurn[] = [];

  constructor(
    private readonly searchService: SearchService,
    private readonly memoryStore: MemoryStore,
    private readonly bridge: PythonBridge,
  ) {}

  async askQuestion(query: string, callbacks: ChatStreamCallbacks): Promise<void> {
    try {
      await this.searchService.ensureReady();

      const ranked = await this.searchService.searchQuery(query, RETRIEVED_NOTES_K);
      const notes = await this.memoryStore.getNotesByIds(ranked.map((r) => r.id));

      // Build prompt BEFORE pushing the user turn so the current query isn't duplicated in the history block
      const prompt = this.buildPrompt(query, notes);
      this.history.push({ role: 'user', text: query });

      const result = await this.bridge.callStream(
        'stream_generate',
        { prompt },
        callbacks.onChunk,
      );

      const citations = this.extractCitations(result.final, notes);
      this.history.push({ role: 'assistant', text: result.final, citations });

      callbacks.onDone(result.final, citations);
    } catch (err) {
      // Failed turn shouldn't poison history — pop the tentatively-pushed user turn if it's still on top
      if (this.history.length > 0 && this.history[this.history.length - 1].role === 'user') {
        this.history.pop();
      }
      callbacks.onError(err as Error);
    }
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): readonly ChatTurn[] {
    return this.history;
  }

  private buildPrompt(query: string, notes: FullNote[]): string {
    const k = notes.length;
    const ruleBlock = `You are DevNote, a developer's memory assistant inside VS Code.
You help developers recall what they did in past work sessions.

Below are the top-${k} dev notes retrieved from the user's notebook,
ranked by semantic relevance. Each note has a title, date, and content.

CRITICAL RULES:
1. Use ONLY information from these dev notes.
2. Do NOT use general knowledge or training data.
3. Do NOT invent dates, code, names, or technical details.
4. If the answer is not in the notes, reply exactly:
   "I don't find that in your notes."
5. Cite sources inline as [Note N] where N is 1-${k}.
6. Use exact dates from notes — do not paraphrase as "last week".
7. Do NOT generate code unless quoting from a note.`;

    const historyBlock = this.formatHistoryBlock();

    // Numbering convention: notes[0] = strongest match = "Note 1" in citations.
    // Display order: weakest first, strongest LAST in the body (closest to the query).
    // This is the lost-in-the-middle mitigation — LLMs attend most to content near the
    // generation point, so the highest-ranked note should be physically closest to "Answer:".
    const notesBlock = notes
      .slice()
      .reverse()                              // [strongest, ..., weakest] → [weakest, ..., strongest]
      .map((n, i) => {
        const rank = notes.length - i;        // i=0 → rank=N (weakest); i=N-1 → rank=1 (strongest)
        const date = new Date(n.createdAt).toISOString().slice(0, 10);
        return `--- Note ${rank} ---\nTitle: ${n.title}\nDate: ${date}\nContent:\n${n.contentMarkdown}`;
      })
      .join('\n\n');

    return [
      ruleBlock,
      historyBlock,
      notesBlock,
      `User question: ${query}`,
      'Answer:',
    ].filter((s) => s.length > 0).join('\n\n');
  }

  private formatHistoryBlock(): string {
    if (this.history.length === 0) return '';

    const recent = this.history.slice(-HISTORY_TURNS_TO_INCLUDE);
    const lines = recent.map((turn) => {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${turn.text}`;
    });
    return ['Conversation so far:', ...lines].join('\n');
  }

  private extractCitations(text: string, notes: FullNote[]): CitationRef[] {
    const matches = [...text.matchAll(/\[Note (\d+)\]/g)];
    const seen = new Set<number>();
    const refs: CitationRef[] = [];

    for (const m of matches) {
      const num = parseInt(m[1], 10);
      if (seen.has(num)) continue;
      if (num < 1 || num > notes.length) {
        console.warn(`[ChatService] LLM cited invalid note number: ${num} (k=${notes.length})`);
        continue;
      }
      seen.add(num);
      refs.push({ noteNumber: num, noteId: notes[num - 1].id });
    }
    return refs;
  }
}
