// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  const STATES = {
    SETUP: 'setup',
    IDLE: 'idle',
    FORM: 'form',
    GENERATING: 'generating',
    PREVIEW: 'preview',
    GENERATE_ERROR: 'generate-error',
    SYNCING: 'syncing',
    DUPLICATE: 'duplicate',
    SUCCESS: 'success',
    SYNC_ERROR: 'sync-error',
  };

  function showState(name) {
    document.querySelectorAll('.state').forEach((el) => {
      el.hidden = el.getAttribute('data-state') !== name;
    });
  }

  function setBranchInfo(branch, canGenerate, reason) {
    const branchEls = document.querySelectorAll('#branch-name, #form-branch-name, #gen-error-branch-name, #sync-error-branch-name');
    branchEls.forEach((el) => { el.textContent = branch || '—'; });

    const generateBtn = document.getElementById('generate-button');
    const reasonEl = document.getElementById('disabled-reason');
    if (generateBtn) {
      generateBtn.disabled = !canGenerate;
    }
    if (reasonEl) {
      if (canGenerate) {
        reasonEl.hidden = true;
      } else {
        reasonEl.textContent = reason || '';
        reasonEl.hidden = false;
      }
    }
  }

  function setLoadingText(text) {
    const generatingText = document.getElementById('generating-text');
    const syncingText = document.getElementById('syncing-text');
    if (generatingText) generatingText.textContent = text;
    if (syncingText) syncingText.textContent = text;
  }

  function setPreview(note) {
    document.getElementById('preview-title').textContent = note.title || '—';
    document.getElementById('preview-summary').textContent = note.summary || '—';
    document.getElementById('preview-why').textContent = note.why || '—';
    document.getElementById('preview-key-decisions').textContent = note.keyDecisions || '—';

    const whatChangedList = document.getElementById('preview-what-changed');
    whatChangedList.innerHTML = '';
    (note.whatChanged || []).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      whatChangedList.appendChild(li);
    });

    const filesList = document.getElementById('preview-files-affected');
    filesList.innerHTML = '';
    (note.filesAffected || []).forEach((file) => {
      const li = document.createElement('li');
      li.textContent = file;
      filesList.appendChild(li);
    });
  }

  function setDraftBanner(draft) {
    const banner = document.getElementById('draft-banner');
    if (!draft) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    document.getElementById('draft-time').textContent = formatTime(draft.createdAt);
    document.getElementById('draft-note-title').textContent = draft.title;
    document.getElementById('draft-error').textContent = draft.lastError;
  }

  function formatTime(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  function renderRecentNotes(notes) {
    const list = document.getElementById('recent-notes-list');
    const empty = document.getElementById('recent-notes-empty');
    const unavailable = document.getElementById('recent-notes-unavailable');

    list.innerHTML = '';
    unavailable.hidden = true;

    if (!notes || notes.length === 0) {
      empty.hidden = false;
      hasRecentNotes = false;
      return;
    }

    empty.hidden = true;
    hasRecentNotes = true;

    notes.forEach((note) => {
      const item = document.createElement('div');
      item.className = 'recent-note-item';
      item.dataset.id = note.id;

      const topRow = document.createElement('div');
      topRow.className = 'recent-note-top';

      const title = document.createElement('span');
      title.className = 'recent-note-title';
      title.textContent = note.title;

      const date = document.createElement('span');
      date.className = 'recent-note-date';
      date.textContent = formatTime(note.createdAt);

      topRow.appendChild(title);
      topRow.appendChild(date);

      const branch = document.createElement('div');
      branch.className = 'recent-note-branch';
      branch.textContent = note.branchName;

      item.appendChild(topRow);
      item.appendChild(branch);

      item.addEventListener('click', () => {
        vscode.postMessage({ type: 'clickRecentNote', id: note.id });
      });

      list.appendChild(item);
    });
  }

  let isHistoricalPreview = false;
  let hasRecentNotes = false;
  let searchMode = false;  // true when user is actively searching
  let currentQuery = '';

  // Chat mode state
  let currentAssistantBubble = null;  // DOM element receiving streaming chunks
  let currentAssistantText = '';      // accumulated raw text for final marked render

  function resetSearchUI() {
    const header = document.getElementById('recent-notes-header');
    const list = document.getElementById('recent-notes-list');
    const searchEmpty = document.getElementById('search-empty');
    const searchLoading = document.getElementById('search-loading');
    if (header) header.textContent = 'Recent Notes';
    if (list) list.innerHTML = '';
    if (searchEmpty) searchEmpty.hidden = true;
    if (searchLoading) searchLoading.hidden = true;
  }

  function renderSearchResults(query, results, error) {
    const header = document.getElementById('recent-notes-header');
    const list = document.getElementById('recent-notes-list');
    const emptyNotes = document.getElementById('recent-notes-empty');
    const searchEmpty = document.getElementById('search-empty');
    const searchLoading = document.getElementById('search-loading');

    emptyNotes.hidden = true;
    searchLoading.hidden = true;
    list.innerHTML = '';

    if (error) {
      header.textContent = 'Search unavailable';
      searchEmpty.textContent = error;
      searchEmpty.hidden = false;
      return;
    }

    if (!results || results.length === 0) {
      header.textContent = `0 results for "${query}"`;
      searchEmpty.textContent = `No strong matches for "${query}". Try different keywords or click ✕ to go back.`;
      searchEmpty.hidden = false;
      return;
    }

    searchEmpty.hidden = true;
    header.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`;

    results.forEach((note) => {
      const item = document.createElement('div');
      item.className = 'recent-note-item';
      item.dataset.id = note.id;

      const topRow = document.createElement('div');
      topRow.className = 'recent-note-top';

      const title = document.createElement('span');
      title.className = 'recent-note-title';
      title.textContent = note.title;

      const scoreAndDate = document.createElement('span');
      scoreAndDate.className = 'recent-note-date';
      const pct = Math.round(note.score * 100);
      scoreAndDate.textContent = `${pct}% · ${formatTime(note.createdAt)}`;

      topRow.appendChild(title);
      topRow.appendChild(scoreAndDate);

      const branch = document.createElement('div');
      branch.className = 'recent-note-branch';
      branch.textContent = note.branchName;

      item.appendChild(topRow);
      item.appendChild(branch);

      item.addEventListener('click', () => {
        vscode.postMessage({ type: 'clickRecentNote', id: note.id });
      });

      list.appendChild(item);
    });
  }

  function setPreviewMode(historical, notionPageUrl) {
    isHistoricalPreview = historical;
    const newActions = document.getElementById('preview-new-actions');
    const notionLink = document.getElementById('preview-notion-link');

    if (historical) {
      newActions.hidden = true;
      if (notionPageUrl) {
        notionLink.href = notionPageUrl;
        notionLink.hidden = false;
      } else {
        notionLink.hidden = true;
      }
    } else {
      newActions.hidden = false;
      notionLink.hidden = true;
    }
  }

  // Setup state listeners
  document.getElementById('save-setup').addEventListener('click', () => {
    const geminiKey = document.getElementById('gemini-key').value.trim();
    const notionToken = document.getElementById('notion-token').value.trim();
    const notionDbId = document.getElementById('notion-db').value.trim();

    if (!geminiKey || !notionToken || !notionDbId) {
      const errEl = document.getElementById('setup-error');
      errEl.textContent = 'Please fill in all 3 fields.';
      errEl.hidden = false;
      return;
    }

    vscode.postMessage({ type: 'saveSetup', geminiKey, notionToken, notionDbId });
  });

  document.getElementById('setup-back').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickBack', from: 'setup' });
  });

  // Success state listener
  document.getElementById('success-back').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickBack', from: 'success' });
  });

  // Idle state listeners
  document.getElementById('generate-button').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickGenerate' });
  });

  // Form state listeners
  const formTitle = document.getElementById('form-title');
  const formSubmit = document.getElementById('form-submit');
  formTitle.addEventListener('input', () => {
    formSubmit.disabled = formTitle.value.trim().length === 0;
  });

  document.getElementById('form-back').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickBack', from: 'form' });
  });

  formSubmit.addEventListener('click', () => {
    vscode.postMessage({
      type: 'submitForm',
      title: formTitle.value.trim(),
      description: document.getElementById('form-description').value.trim() || undefined,
    });
  });

  // Preview state listeners
  document.getElementById('preview-back').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickBack', from: isHistoricalPreview ? 'historical-preview' : 'preview' });
  });

  document.getElementById('preview-save').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickSaveNote' });
  });

  document.getElementById('preview-discard').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDiscard' });
  });

  // Error state listeners
  document.getElementById('gen-error-retry').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickRetry', kind: 'generate' });
  });

  document.getElementById('sync-error-retry').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickRetry', kind: 'sync' });
  });

  // Duplicate choice listeners
  document.getElementById('dup-append').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDuplicateChoice', choice: 'append' });
  });

  document.getElementById('dup-replace').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDuplicateChoice', choice: 'replace' });
  });

  document.getElementById('dup-cancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDuplicateChoice', choice: 'cancel' });
  });

  // Draft recovery listeners
  document.getElementById('draft-retry').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickRetryDraft' });
  });

  document.getElementById('draft-discard').addEventListener('click', () => {
    vscode.postMessage({ type: 'clickDiscardDraft' });
  });

  // Gear icon
  document.getElementById('gear-button').addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

  // Clear memory popup
  document.getElementById('clear-memory-button')?.addEventListener('click', () => {
    document.getElementById('clear-memory-popup').hidden = false;
    document.getElementById('clear-export-checkbox').checked = false;
    document.getElementById('clear-cancel').focus();
  });

  document.getElementById('clear-cancel')?.addEventListener('click', () => {
    document.getElementById('clear-memory-popup').hidden = true;
  });

  document.getElementById('clear-confirm')?.addEventListener('click', () => {
    const exportFirst = document.getElementById('clear-export-checkbox').checked;
    document.getElementById('clear-memory-popup').hidden = true;
    vscode.postMessage({ type: 'clickClearMemory', exportFirst });
  });

  // Search input with debounce + clear button
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  let searchDebounce = null;

  searchInput?.addEventListener('input', () => {
    const value = searchInput.value;
    searchClear.hidden = value.length === 0;

    if (searchDebounce) clearTimeout(searchDebounce);

    if (value.trim().length === 0) {
      searchMode = false;
      currentQuery = '';
      resetSearchUI();
      vscode.postMessage({ type: 'clearSearch' });
      return;
    }

    searchDebounce = setTimeout(() => {
      currentQuery = value.trim();
      searchMode = true;
      // Show loading state
      const loading = document.getElementById('search-loading');
      const empty = document.getElementById('recent-notes-empty');
      const list = document.getElementById('recent-notes-list');
      list.innerHTML = '';
      empty.hidden = true;
      if (loading) loading.hidden = false;
      document.getElementById('recent-notes-header').textContent = `Searching "${currentQuery}"…`;

      vscode.postMessage({ type: 'searchQuery', query: currentQuery });
    }, 300);

    applyMode();
  });

  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchMode = false;
    currentQuery = '';
    resetSearchUI();
    vscode.postMessage({ type: 'clearSearch' });
    applyMode();
  });

  // Chat mode: cached DOM + handlers
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send');
  const chatClearBtn = document.getElementById('chat-clear');
  const chatNewBtn = document.getElementById('chat-new');
  const chatTranscript = document.getElementById('chat-transcript');
  const chatBubbles = document.getElementById('chat-bubbles');

  function resolveMode() {
    const hasSearchText = searchInput && searchInput.value.trim().length > 0;
    const hasChatText = chatInput && chatInput.value.trim().length > 0;
    const chatActive = hasChatText
      || currentAssistantBubble !== null
      || (chatBubbles && chatBubbles.children.length > 0);
    if (chatActive) return 'chat';
    if (hasSearchText) return 'search';
    return 'recent';
  }

  function applyMode() {
    const mode = resolveMode();
    const recentList = document.getElementById('recent-notes-list');
    const recentEmpty = document.getElementById('recent-notes-empty');
    const recentHeader = document.getElementById('recent-notes-header');
    const searchEmpty = document.getElementById('search-empty');
    const searchLoading = document.getElementById('search-loading');

    if (mode === 'chat') {
      if (recentList) recentList.hidden = true;
      if (recentEmpty) recentEmpty.hidden = true;
      if (recentHeader) recentHeader.hidden = true;
      if (searchEmpty) searchEmpty.hidden = true;
      if (searchLoading) searchLoading.hidden = true;
      if (chatTranscript) chatTranscript.hidden = false;
    } else {
      if (recentList) recentList.hidden = false;
      if (recentHeader) recentHeader.hidden = false;
      if (chatTranscript) chatTranscript.hidden = true;
      // recent/search-empty visibility is managed by their respective render fns
    }
  }

  chatSendBtn?.addEventListener('click', sendChat);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
  chatInput?.addEventListener('input', () => {
    chatSendBtn.disabled = chatInput.value.trim().length === 0;
    chatClearBtn.hidden = chatInput.value.length === 0;
    applyMode();
  });

  chatClearBtn?.addEventListener('click', () => {
    chatInput.value = '';
    chatSendBtn.disabled = true;
    chatClearBtn.hidden = true;
    applyMode();
  });

  chatNewBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'chat-clear' });
  });

  function sendChat() {
    const query = chatInput.value.trim();
    if (!query) return;
    chatInput.value = '';
    chatSendBtn.disabled = true;
    chatClearBtn.hidden = true;
    vscode.postMessage({ type: 'chat-ask', query });
  }

  // Chat bubble rendering helpers
  function appendUserBubble(text) {
    const div = document.createElement('div');
    div.className = 'chat-bubble user';
    div.textContent = text;
    chatBubbles.appendChild(div);
    scrollChatToBottom();
  }

  function appendAssistantBubble() {
    const div = document.createElement('div');
    div.className = 'chat-bubble assistant';
    chatBubbles.appendChild(div);
    scrollChatToBottom();
    return div;
  }

  function appendErrorBubble(message) {
    const div = document.createElement('div');
    div.className = 'chat-bubble error';
    div.textContent = `Error: ${message}`;
    chatBubbles.appendChild(div);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    if (chatTranscript) chatTranscript.scrollTop = chatTranscript.scrollHeight;
  }

  function renderFinalMarkdown(bubble, finalText, citations) {
    let html = (typeof marked !== 'undefined' && marked.parse)
      ? marked.parse(finalText, { breaks: true })
      : finalText;

    const lookup = {};
    for (const c of citations) lookup[c.noteNumber] = c.noteId;

    html = html.replace(/\[Note (\d+)\]/g, (match, numStr) => {
      const num = parseInt(numStr, 10);
      if (lookup[num]) {
        const safeId = String(lookup[num]).replace(/"/g, '&quot;');
        return `<a class="citation-pill" data-note-id="${safeId}" href="#">Note ${num}</a>`;
      }
      return match;
    });

    bubble.innerHTML = html;

    bubble.querySelectorAll('.citation-pill').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'chat-open-note', noteId: el.dataset.noteId });
      });
    });
  }

  // Reset Python env + Re-index all buttons (Settings)
  document.getElementById('reset-python-env-button')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clickResetPythonEnv' });
  });

  document.getElementById('reindex-all-button')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clickReindexAll' });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const popup = document.getElementById('clear-memory-popup');
      if (popup && !popup.hidden) {
        popup.hidden = true;
      }
    }
  });

  // Listen for messages from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'setState':
        showState(msg.state);
        if (msg.state === STATES.PREVIEW && msg.data?.note) {
          setPreview(msg.data.note);
          setPreviewMode(!!msg.data.isHistorical, msg.data.notionPageUrl || null);
        }
        if (msg.state === STATES.DUPLICATE && msg.data?.title) {
          document.getElementById('duplicate-title').textContent = msg.data.title;
        }
        if (msg.state === STATES.GENERATE_ERROR && msg.data?.message) {
          document.getElementById('gen-error-message').textContent = msg.data.message;
        }
        if (msg.state === STATES.SYNC_ERROR && msg.data?.message) {
          document.getElementById('sync-error-message').textContent = msg.data.message;
        }
        if (msg.state === STATES.SUCCESS && msg.data?.message) {
          document.getElementById('success-text').textContent = msg.data.message;
        }
        break;
      case 'setBranchInfo':
        setBranchInfo(msg.branch, msg.canGenerate, msg.reason);
        break;
      case 'setLoadingText':
        setLoadingText(msg.text);
        break;
      case 'setDraft':
        setDraftBanner(msg.draft);
        break;
      case 'restoreForm':
        if (msg.title) document.getElementById('form-title').value = msg.title;
        if (msg.description) document.getElementById('form-description').value = msg.description;
        formSubmit.disabled = !msg.title;
        break;
      case 'setRecentNotes':
        renderRecentNotes(msg.notes);
        break;
      case 'prefillSetup':
        document.getElementById('gemini-key').value = msg.geminiKey || '';
        document.getElementById('notion-token').value = msg.notionToken || '';
        document.getElementById('notion-db').value = msg.notionDbId || '';
        // Only show clear memory section when notes exist
        var clearSection = document.getElementById('clear-memory-section');
        if (clearSection) clearSection.hidden = !hasRecentNotes;
        // Reveal utility buttons
        var resetBtn = document.getElementById('reset-python-env-button');
        var reindexBtn = document.getElementById('reindex-all-button');
        if (resetBtn) resetBtn.hidden = false;
        if (reindexBtn) reindexBtn.hidden = !hasRecentNotes;
        break;
      case 'setSearchLoading':
        {
          const loading = document.getElementById('search-loading');
          const header = document.getElementById('recent-notes-header');
          const list = document.getElementById('recent-notes-list');
          if (loading) loading.hidden = false;
          if (list) list.innerHTML = '';
          if (header) header.textContent = `Searching "${msg.query}"…`;
        }
        break;
      case 'setSearchResults':
        renderSearchResults(msg.query, msg.results, msg.error);
        break;
      case 'chat-user-turn':
        appendUserBubble(msg.text);
        currentAssistantBubble = appendAssistantBubble();
        currentAssistantText = '';
        applyMode();
        break;
      case 'chat-token':
        if (currentAssistantBubble) {
          currentAssistantText += msg.text;
          currentAssistantBubble.textContent = currentAssistantText;
          scrollChatToBottom();
        }
        break;
      case 'chat-done':
        if (currentAssistantBubble) {
          renderFinalMarkdown(currentAssistantBubble, msg.finalText, msg.citations || []);
          currentAssistantBubble = null;
          currentAssistantText = '';
        }
        break;
      case 'chat-error':
        appendErrorBubble(msg.message);
        currentAssistantBubble = null;
        currentAssistantText = '';
        break;
      case 'chat-cleared':
        if (chatBubbles) chatBubbles.innerHTML = '';
        currentAssistantBubble = null;
        currentAssistantText = '';
        applyMode();
        break;
    }
  });

  // Tell extension we're ready
  vscode.postMessage({ type: 'ready' });
})();
