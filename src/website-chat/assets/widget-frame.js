(() => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const widgetId = params.get('widgetId') || '';
  const siteOrigin = params.get('siteOrigin') || '';
  const apiBase = `${window.location.origin}/public/widgets/${encodeURIComponent(widgetId)}`;
  const root = document.getElementById('widget-root');
  const tokenKey = `kleva.website.${widgetId}.${siteOrigin}`;
  const state = { config: null, token: '', cursor: null, open: false, sending: false, contactSaved: false, unread: 0, loaded: false, timer: 0, eventController: null, eventRetryTimer: 0, eventRetry: 0, realtimeState: 'connecting', typingActor: '', typingTimer: 0, pendingSend: null, sendError: '' };
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled in embedded contexts. */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* Storage may be disabled in embedded contexts. */ } }
  };

  function notifySize() {
    parent.postMessage({ type: 'kleva-widget-size', open: state.open, position: state.config?.configuration?.position }, siteOrigin);
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('X-Kleva-Site-Origin', siteOrigin);
    headers.set('Accept', 'application/json');
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetch(`${apiBase}${path}`, { ...init, headers, cache: 'no-store', credentials: 'omit' }).then(async (response) => {
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(value?.message || value?.error?.message || 'Chat is temporarily unavailable. Please try again.');
        error.status = response.status;
        throw error;
      }
      return value;
    });
  }
  function showError(message) {
    const old = root.querySelector('[role="alert"]');
    if (old) old.remove();
    const alert = el('p', 'error', message); alert.setAttribute('role', 'alert');
    root.querySelector('.window')?.append(alert);
  }
  function showNotice(message) {
    const notice = el('p', 'notice', message); notice.setAttribute('role', 'status');
    root.querySelector('.window')?.append(notice);
  }
  function render() {
    const config = state.config;
    root.replaceChildren();
    if (!state.open) {
      const launcher = el('button', 'launcher');
      launcher.type = 'button'; launcher.setAttribute('aria-label', `Open chat with ${config.businessName}`);
      if (state.unread) launcher.setAttribute('aria-label', `Open chat with ${config.businessName}, ${state.unread} new ${state.unread === 1 ? 'reply' : 'replies'}`);
      launcher.style.setProperty('--brand', config.configuration.primaryColor);
      const badge = el('span', 'launcher-badge', state.unread ? String(state.unread) : '');
      launcher.append(badge, document.createTextNode('Chat with us'));
      launcher.addEventListener('click', () => { state.open = true; state.unread = 0; render(); notifySize(); root.querySelector('.close')?.focus(); });
      root.append(launcher); notifySize(); return;
    }
    const shell = el('section', `window ${config.configuration.position === 'bottom-left' ? 'left' : ''} ${config.configuration.theme === 'dark' ? 'dark' : ''}`);
    shell.style.setProperty('--brand', config.configuration.primaryColor);
    shell.setAttribute('aria-label', `Chat with ${config.businessName}`);
    const header = el('header', 'header');
    if (config.configuration.logoUrl) { const logo = el('img', 'logo'); logo.src = config.configuration.logoUrl; logo.alt = ''; header.append(logo); }
    const names = el('div'); names.append(el('div', 'business', config.businessName), el('div', 'assistant', `${config.assistantName} · AI assistant`));
    const close = el('button', 'close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close chat'); close.addEventListener('click', () => { state.open = false; render(); notifySize(); root.querySelector('.launcher')?.focus(); });
    header.append(names, close); shell.append(header);
    const availability = config.availability === 'CLOSED'
      ? `${config.configuration.offlineMessage}${config.aiEnabled ? ' The AI assistant can still answer questions.' : ''}`
      : config.aiEnabled ? 'AI assistant available · A person can join anytime' : 'Messages stay here for the business to review';
    const connectionLabel = state.realtimeState === 'connected' ? 'Connected' : state.realtimeState === 'connecting' ? 'Connecting…' : state.realtimeState === 'offline' ? 'Offline · reconnecting' : 'Reconnecting…';
    const connectionStatus = el('div', 'status', `${connectionLabel} · ${availability}`); connectionStatus.setAttribute('role', 'status'); connectionStatus.setAttribute('aria-live', 'polite'); shell.append(connectionStatus);

    if (config.configuration.requireContact && !state.contactSaved) {
      shell.append(el('p', 'offline', 'Before chatting, share your contact details with your consent.'));
      shell.append(contactForm(config.configuration));
    } else {
      const list = el('div', 'messages'); list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite'); list.setAttribute('aria-relevant', 'additions text'); list.setAttribute('aria-label', 'Conversation messages');
      for (const item of state.messages || []) {
        const bubble = el('div', `bubble ${item.direction === 'inbound' ? 'inbound' : 'outbound'}`);
        bubble.append(document.createTextNode(item.content));
        const time = new Date(item.createdAt);
        if (Number.isFinite(time.getTime())) bubble.append(el('span', 'stamp', new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time)));
        list.append(bubble);
      }
      if (state.pendingSend) {
        const pending = el('div', 'bubble inbound pending', state.pendingSend.text);
        pending.append(el('span', 'stamp', state.sending ? 'Sending…' : 'Not sent'));
        list.append(pending);
      }
      if (state.typingActor) list.append(el('div', 'typing', state.typingActor === 'assistant' ? 'AI assistant is replying…' : 'A team member is typing…'));
      if (state.sending) list.append(el('div', 'typing', 'Sending…'));
      shell.append(list);
      if (state.messages?.length <= 1 && config.configuration.suggestedQuestions.length) {
        const suggestions = el('div', 'questions');
        for (const suggestion of config.configuration.suggestedQuestions) {
          const button = el('button', 'question', suggestion); button.type = 'button'; button.addEventListener('click', () => send(suggestion)); suggestions.append(button);
        }
        shell.append(suggestions);
      }
      if (config.configuration.collectContact) {
        const contact = el('button', 'request-human', 'Share contact details'); contact.type = 'button'; contact.addEventListener('click', () => shell.insertBefore(contactForm(config.configuration), shell.querySelector('.privacy'))); shell.append(contact);
      }
      const handoff = el('button', 'request-human', 'Request a human'); handoff.type = 'button'; handoff.addEventListener('click', requestHuman); shell.append(handoff);
      const form = el('form', 'composer');
      const input = el('input'); input.type = 'text'; input.name = 'message'; input.maxLength = 2000; input.autocomplete = 'off'; input.placeholder = 'Type your message…'; input.setAttribute('aria-label', 'Your message'); input.required = true;
      input.value = state.draft || '';
      input.addEventListener('input', () => { state.draft = input.value; if (input.value.trim()) sendTyping(true); else sendTyping(false); });
      input.addEventListener('blur', () => sendTyping(false));
      const submit = el('button', '', 'Send'); submit.type = 'submit'; submit.disabled = state.sending;
      form.append(input, submit); form.addEventListener('submit', (event) => { event.preventDefault(); const text = input.value.trim(); if (text) send(text); }); shell.append(form);
      if (state.pendingSend && !state.sending) {
        const retry = el('button', 'request-human', 'Retry message'); retry.type = 'button'; retry.addEventListener('click', () => send(state.pendingSend.text)); shell.append(retry);
        if (state.sendError) { const error = el('p', 'error', state.sendError); error.setAttribute('role', 'alert'); shell.append(error); }
      }
    }
    const privacy = el('div', 'privacy', config.configuration.privacyNotice); shell.append(privacy);
    root.append(shell); notifySize();
    const list = shell.querySelector('.messages'); if (list) list.scrollTop = list.scrollHeight;
  }
  function contactForm(config) {
    const form = el('form', 'contact'); form.setAttribute('aria-label', 'Share contact details');
    const name = el('input'); name.name = 'name'; name.autocomplete = 'name'; name.maxLength = 120; name.placeholder = 'Name (optional)'; name.setAttribute('aria-label', 'Name');
    const email = el('input'); email.name = 'email'; email.type = 'email'; email.autocomplete = 'email'; email.maxLength = 254; email.placeholder = 'Email (optional)'; email.setAttribute('aria-label', 'Email');
    const phone = el('input'); phone.name = 'phone'; phone.type = 'tel'; phone.autocomplete = 'tel'; phone.maxLength = 32; phone.placeholder = 'Phone (optional)'; phone.setAttribute('aria-label', 'Phone');
    const consentLabel = el('label', 'consent'); const consent = el('input'); consent.type = 'checkbox'; consent.required = true; consentLabel.append(consent, document.createTextNode('I agree to share these details so the business can respond.'));
    const submit = el('button', 'contact-submit', 'Save contact'); submit.type = 'submit';
    form.append(name,email,phone,consentLabel,submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = { consent: consent.checked, ...(name.value.trim() ? { name: name.value.trim() } : {}), ...(email.value.trim() ? { email: email.value.trim() } : {}), ...(phone.value.trim() ? { phone: phone.value.trim() } : {}) };
      try { await request('/contact', { method: 'POST', body: JSON.stringify(data) }); state.contactSaved = true; render(); }
      catch (error) { showError(error.message); }
    });
    return form;
  }
  async function send(text) {
    if (state.sending) return;
    if (!state.pendingSend || state.pendingSend.text !== text) state.pendingSend = { text, idempotencyKey: crypto.randomUUID() };
    state.sending = true; state.sendError = ''; state.draft = ''; sendTyping(false); render();
    try { await request('/messages', { method: 'POST', body: JSON.stringify(state.pendingSend) }); state.pendingSend = null; await refresh(); }
    catch (error) { state.sendError = error.message || 'Message could not be sent.'; state.draft = text; }
    finally { state.sending = false; render(); }
  }
  function sendTyping(active) {
    if (!state.token) return;
    if (state.typingTimer) window.clearTimeout(state.typingTimer);
    if (!active) { request('/typing', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => undefined); return; }
    state.typingTimer = window.setTimeout(() => request('/typing', { method: 'POST', body: JSON.stringify({ active: true }) }).catch(() => undefined), 250);
  }
  async function requestHuman() {
    try { await request('/handoff', { method: 'POST', body: '{}' }); await refresh(); showNotice('A team member has been notified.'); }
    catch (error) { showError(error.message); }
  }
  async function refresh() {
    const query = state.cursor ? `?after=${encodeURIComponent(state.cursor)}` : '';
    const result = await request(`/messages${query}`);
    state.contactSaved = result.contactSaved === true;
    if (!state.messages) state.messages = [];
    const known = new Set(state.messages.map((item) => item.id));
    const fresh = result.items.filter((item) => !known.has(item.id));
    if (state.loaded && !state.open) state.unread += fresh.filter((item) => item.direction === 'outbound').length;
    state.messages.push(...fresh);
    if (state.messages.length > 100) state.messages = state.messages.slice(-100);
    state.cursor = result.nextCursor;
    state.loaded = true;
    if (state.open) render();
  }
  async function connectEvents() {
    if (!state.token) return;
    const controller = new AbortController(); state.eventController = controller;
    let connectedAt = 0; let retryAfterMs = 0;
    try {
      const response = await fetch(`${apiBase}/events`, { headers: { Authorization: `Bearer ${state.token}`, 'X-Kleva-Site-Origin': siteOrigin, Accept: 'text/event-stream' }, cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok || !response.body) { retryAfterMs = Math.min(60000, Math.max(0, Number(response.headers.get('retry-after') || 0) * 1000)); throw new Error('realtime unavailable'); }
      connectedAt = Date.now(); state.realtimeState = 'connected'; render();
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true }); let match = /\r?\n\r?\n/.exec(pending);
        while (match) {
          const frame = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
          const eventName = frame.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim();
          const data = frame.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (eventName === 'ready') {
            try { const ready = JSON.parse(data || '{}'); state.realtimeState = ready.realtime === false ? 'reconnecting' : 'connected'; if (state.open) render(); } catch { state.realtimeState = 'reconnecting'; }
            await refresh().catch(() => undefined);
          }
          if (data) {
            try {
              const event = JSON.parse(data);
              if (eventName === 'session.revoked') { state.token = ''; storage.remove(tokenKey); if (state.eventRetryTimer) window.clearTimeout(state.eventRetryTimer); state.eventRetryTimer = 0; showNotice('This chat session has ended. Refresh the page to start again.'); controller.abort(); break; }
              if (eventName === 'typing.started' && ['assistant','human'].includes(event.actor)) { state.typingActor = event.actor; if (state.typingTimer) window.clearTimeout(state.typingTimer); state.typingTimer = window.setTimeout(() => { state.typingActor = ''; if (state.open) render(); }, 6000); if (state.open) render(); }
              if (eventName === 'typing.stopped' && state.typingActor === event.actor) { state.typingActor = ''; if (state.typingTimer) window.clearTimeout(state.typingTimer); if (state.open) render(); }
              if (['message.created','message.updated','conversation.updated','conversation.resolved','conversation.reopened','conversation.control.changed'].includes(eventName)) await refresh().catch(() => undefined);
            } catch { /* Reconcile from durable history on the next event or poll. */ }
          }
          match = /\r?\n\r?\n/.exec(pending);
        }
      }
    } catch { /* The durable message poll below remains available during an SSE outage. */ }
    if (state.eventController === controller) state.eventController = null;
    if (!controller.signal.aborted && state.token) {
      if (connectedAt && Date.now() - connectedAt >= 30000) state.eventRetry = 0;
      state.eventRetry = Math.min(state.eventRetry + 1, 6);
      state.realtimeState = state.eventRetry >= 4 ? 'offline' : 'reconnecting';
      const delay = Math.max(retryAfterMs, Math.min(30000, 500 * 2 ** state.eventRetry) + Math.random() * 300);
      if (state.eventRetryTimer) window.clearTimeout(state.eventRetryTimer);
      state.eventRetryTimer = window.setTimeout(() => { state.eventRetryTimer = 0; void connectEvents(); }, delay); if (state.open) render();
    }
  }
  async function start() {
    try {
      state.config = await request('/config');
      const saved = storage.get(tokenKey);
      if (saved) { try { const parsed = JSON.parse(saved); if (parsed.expiresAt > Date.now()) state.token = parsed.token; } catch { /* Start a clean visitor session. */ } }
      if (state.token) {
        try { await refresh(); } catch (error) { if (error.status !== 403 && error.status !== 404) throw error; state.token = ''; storage.remove(tokenKey); }
      }
      if (!state.token) {
        const session = await request('/sessions', { method: 'POST', body: '{}' }); state.token = session.token;
        storage.set(tokenKey, JSON.stringify({ token: session.token, expiresAt: Date.now() + session.expiresInSeconds * 1000 }));
        await refresh();
      }
      render();
      void connectEvents();
      state.timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh().catch(() => undefined); }, state.open ? 1800 : 6000);
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.open) { state.open = false; render(); notifySize(); root.querySelector('.launcher')?.focus(); } });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().catch(() => undefined); });
    } catch (error) {
      root.append(el('div', 'offline', error.message || 'Chat is unavailable.'));
    }
  }
  // The URL's siteOrigin is only a hint. Start networking only after the
  // actual embedding page proves the same origin through browser postMessage.
  const initialize = (event) => {
    if (event.source !== parent || event.origin !== siteOrigin || event.data?.type !== 'kleva-widget-init') return;
    window.removeEventListener('message', initialize);
    start();
  };
  window.addEventListener('message', initialize);
})();
