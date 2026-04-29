import * as vscode from 'vscode';
import { ConfigService } from './ConfigService';
import { SidebarProvider } from './SidebarProvider';
import { DraftStore } from './DraftStore';
import { MemoryStore } from './MemoryStore';
import { SearchService } from './SearchService';
import { ChatService } from './ChatService';
import { PythonBridge } from './PythonBridge';

let searchService: SearchService | null = null;
let chatService: ChatService | null = null;

export function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigService(context.secrets);
  const draftStore = new DraftStore(context);
  const memoryStore = new MemoryStore(context);

  memoryStore.init().catch((err) => {
    console.error('[DevNote] MemoryStore init failed:', err);
  });

  // SearchService is created on demand once we have a Gemini key.
  // It's lazy — no Python spawn here.
  void configService.getGeminiApiKey().then((key) => {
    if (key) {
      searchService = new SearchService(context, memoryStore, key);
    }
  });

  const buildChatService = (svc: SearchService): ChatService => {
    // ChatService streams via the same Python worker SearchService owns.
    // SearchService.ensureReady() (called inside ChatService.askQuestion) spawns the bridge,
    // so we hand ChatService a reference to the same private field via a typed accessor.
    const bridgeRef: PythonBridge = (svc as unknown as { bridge: PythonBridge }).bridge
      ?? new Proxy({} as PythonBridge, {
        get(_t, prop) {
          const b = (svc as unknown as { bridge: PythonBridge | null }).bridge;
          if (!b) throw new Error('Python bridge not ready — call SearchService.ensureReady() first.');
          return (b as any)[prop];
        },
      });
    return new ChatService(svc, memoryStore, bridgeRef);
  };

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context,
    configService,
    draftStore,
    memoryStore,
    (apiKey?: string) => {
      if (!searchService && apiKey) {
        searchService = new SearchService(context, memoryStore, apiKey);
      }
      return searchService;
    },
    (apiKey?: string) => {
      if (!searchService && apiKey) {
        searchService = new SearchService(context, memoryStore, apiKey);
      }
      if (!searchService) return null;
      if (!chatService) {
        chatService = buildChatService(searchService);
      }
      return chatService;
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devnote.create', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devnote-sidebar');
      await sidebarProvider.triggerGenerate();
    })
  );

  // Expose for setup-after-configure
  context.subscriptions.push({
    dispose: () => {
      void searchService?.shutdown();
    },
  });
}

export function deactivate() {
  void searchService?.shutdown();
}
