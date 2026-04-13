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
    vscode.postMessage({ type: 'clickBack', from: 'preview' });
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

  // Listen for messages from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'setState':
        showState(msg.state);
        if (msg.state === STATES.PREVIEW && msg.data?.note) {
          setPreview(msg.data.note);
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
      case 'prefillSetup':
        document.getElementById('gemini-key').value = msg.geminiKey || '';
        document.getElementById('notion-token').value = msg.notionToken || '';
        document.getElementById('notion-db').value = msg.notionDbId || '';
        break;
    }
  });

  // Tell extension we're ready
  vscode.postMessage({ type: 'ready' });
})();
