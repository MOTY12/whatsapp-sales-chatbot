'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type {
  Conversation,
  ConversationDetail,
  CursorPage,
  InboxMessage,
  InboxMode,
} from '@/lib/api';
import {
  formatInboxTime,
  mergeMessages,
  messageFailureText,
  messageStatusLabel,
  senderLabel,
} from './presentation';
import styles from './inbox.module.css';

type ApiFailure = { code: string; message: string };
type Props = {
  businessId: string;
  initialPage: CursorPage<Conversation> | null;
  initialError: ApiFailure | null;
  initialConversationId?: string;
};
type ThreadData = {
  detail: ConversationDetail;
  messages: CursorPage<InboxMessage>;
};

class InboxRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getInboxJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.method === 'POST') {
    const csrf = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => /kleva_csrf=/i.test(part));
    if (csrf)
      headers.set(
        'X-CSRF-Token',
        decodeURIComponent(csrf.slice(csrf.indexOf('=') + 1)),
      );
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: 'no-store', headers });
  } catch {
    throw new InboxRequestError(
      0,
      'unavailable',
      'Kleva is temporarily unavailable. Please try again.',
    );
  }
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('kleva-session-expired'));
    throw new InboxRequestError(
      401,
      'unauthorized',
      'Your session has expired.',
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: ApiFailure;
    } | null;
    throw new InboxRequestError(
      response.status,
      body?.error?.code ?? 'unavailable',
      body?.error?.message ?? 'The inbox could not be updated.',
    );
  }
  return response.json() as Promise<T>;
}

function inboxPath(businessId: string, suffix = '') {
  return `/api/inbox/${encodeURIComponent(businessId)}/conversations${suffix}`;
}

function mergeConversations(current: Conversation[], incoming: Conversation[]) {
  const byId = new Map(
    incoming.map((conversation) => [conversation.id, conversation]),
  );
  for (const conversation of current)
    if (!byId.has(conversation.id)) byId.set(conversation.id, conversation);
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(b.last_activity) - Date.parse(a.last_activity) ||
      a.id.localeCompare(b.id),
  );
}

function displayName(
  conversation: Pick<Conversation, 'customer_name' | 'customer_whatsapp_id'>,
) {
  return (
    conversation.customer_name?.trim() || conversation.customer_whatsapp_id
  );
}

function modeLabel(mode: InboxMode) {
  return mode === 'HUMAN' ? 'Human takeover' : 'Automation active';
}

export function InboxExperience({
  businessId,
  initialPage,
  initialError,
  initialConversationId,
}: Props) {
  const router = useRouter();
  const initialItems = initialPage?.items ?? [];
  const [conversations, setConversations] = useState(initialItems);
  const [listCursor, setListCursor] = useState(initialPage?.nextCursor ?? null);
  const [listError, setListError] = useState<ApiFailure | null>(initialError);
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId ?? initialItems[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(
    Boolean(initialConversationId || initialItems[0]),
  );
  const [threadError, setThreadError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [releaseConfirmation, setReleaseConfirmation] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [threadRequestVersion, setThreadRequestVersion] = useState(0);

  const selectedRef = useRef(selectedId);
  const messagesPaneRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const pendingBottomRef = useRef(true);
  const pendingRestoreRef = useRef<{ top: number; height: number } | null>(
    null,
  );
  const pollingRef = useRef(false);
  const replyKeyRef = useRef<{ text: string; key: string } | null>(null);
  const queuedMessageRef = useRef<string | null>(null);

  useEffect(() => {
    const onExpired = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', onExpired);
    return () => window.removeEventListener('kleva-session-expired', onExpired);
  }, [router]);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const mode =
    detail?.control_mode ?? selectedConversation?.control_mode ?? 'AUTO';
  const inFlight = Number(
    detail?.in_flight ?? selectedConversation?.in_flight ?? 0,
  );

  const loadThread = useCallback(
    async (
      conversationId: string,
      signal?: AbortSignal,
    ): Promise<ThreadData> => {
      const base = inboxPath(
        businessId,
        `/${encodeURIComponent(conversationId)}`,
      );
      const [conversation, page] = await Promise.all([
        getInboxJson<ConversationDetail>(base, { signal }),
        getInboxJson<CursorPage<InboxMessage>>(`${base}/messages?limit=30`, {
          signal,
        }),
      ]);
      return { detail: conversation, messages: page };
    },
    [businessId],
  );

  useEffect(() => {
    selectedRef.current = selectedId;
    if (!selectedId) return;
    const controller = new AbortController();
    void loadThread(selectedId, controller.signal)
      .then((data) => {
        if (selectedRef.current !== selectedId) return;
        pendingBottomRef.current = true;
        setDetail(data.detail);
        setMessages(data.messages.items);
        setMessageCursor(data.messages.nextCursor);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || selectedRef.current !== selectedId)
          return;
        setThreadError(
          error instanceof Error
            ? error.message
            : 'This conversation could not be opened.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted && selectedRef.current === selectedId)
          setThreadLoading(false);
      });
    return () => controller.abort();
  }, [loadThread, selectedId, threadRequestVersion]);

  useLayoutEffect(() => {
    const pane = messagesPaneRef.current;
    if (!pane || !messages.length) return;
    if (pendingRestoreRef.current) {
      const restore = pendingRestoreRef.current;
      pane.scrollTop = restore.top + (pane.scrollHeight - restore.height);
      pendingRestoreRef.current = null;
    } else if (pendingBottomRef.current) {
      pane.scrollTop = pane.scrollHeight;
      nearBottomRef.current = true;
      pendingBottomRef.current = false;
    }
  }, [messages]);

  const refreshList = useCallback(
    async (append = false) => {
      if (append) setListLoading(true);
      try {
        const cursor = append ? listCursor : undefined;
        const page = await getInboxJson<CursorPage<Conversation>>(
          inboxPath(
            businessId,
            `?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          ),
        );
        setConversations((current) =>
          append
            ? mergeConversations(current, page.items)
            : current.length > (initialItems.length || 0)
              ? mergeConversations(current, page.items)
              : page.items,
        );
        if (append || conversations.length <= initialItems.length)
          setListCursor(page.nextCursor);
        setListError(null);
      } catch (error) {
        setListError({
          code: error instanceof InboxRequestError ? error.code : 'unavailable',
          message:
            error instanceof Error
              ? error.message
              : 'The inbox could not be loaded.',
        });
      } finally {
        if (append) setListLoading(false);
      }
    },
    [businessId, conversations.length, initialItems.length, listCursor],
  );

  const refreshListRef = useRef(refreshList);
  useEffect(() => {
    refreshListRef.current = refreshList;
  }, [refreshList]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshListRef.current(false);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let stopped = false;
    const poll = async () => {
      if (
        stopped ||
        document.visibilityState === 'hidden' ||
        pollingRef.current
      )
        return;
      const conversationId = selectedRef.current;
      if (!conversationId) return;
      pollingRef.current = true;
      const controller = new AbortController();
      try {
        const base = inboxPath(
          businessId,
          `/${encodeURIComponent(conversationId)}`,
        );
        const [nextDetail, recent] = await Promise.all([
          getInboxJson<ConversationDetail>(base, { signal: controller.signal }),
          getInboxJson<CursorPage<InboxMessage>>(`${base}/messages?limit=30`, {
            signal: controller.signal,
          }),
        ]);
        if (stopped || selectedRef.current !== conversationId) return;
        setDetail(nextDetail);
        nearBottomRef.current = messagesPaneRef.current
          ? messagesPaneRef.current.scrollHeight -
              messagesPaneRef.current.scrollTop -
              messagesPaneRef.current.clientHeight <
            100
          : false;
        pendingBottomRef.current = nearBottomRef.current;
        setMessages((current) => mergeMessages(current, recent.items));
        const queuedMessage =
          queuedMessageRef.current &&
          recent.items.find(
            (message) => message.id === queuedMessageRef.current,
          );
        if (
          queuedMessage &&
          !['QUEUED', 'PENDING', 'RESERVED', 'SENDING'].includes(
            queuedMessage.status.toUpperCase(),
          )
        ) {
          setQueuedNotice(
            messageFailureText(queuedMessage) ??
              `Reply ${messageStatusLabel(queuedMessage.status).toLowerCase()}.`,
          );
        }
        setConversations((current) =>
          current.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  status: nextDetail.status,
                  control_mode: nextDetail.control_mode,
                  control_version: nextDetail.control_version,
                  in_flight: nextDetail.in_flight,
                }
              : item,
          ),
        );
      } catch (error) {
        if (
          !stopped &&
          selectedRef.current === conversationId &&
          error instanceof InboxRequestError &&
          error.status === 404
        ) {
          setThreadError('This conversation is no longer available.');
          setDetail(null);
        }
      } finally {
        pollingRef.current = false;
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 8_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [businessId, selectedId]);

  async function selectConversation(conversationId: string) {
    selectedRef.current = conversationId;
    setDetail(null);
    setMessages([]);
    setMessageCursor(null);
    setThreadLoading(true);
    setThreadError(null);
    setHistoryError(null);
    setControlError(null);
    setReleaseConfirmation(false);
    setReplyError(null);
    setQueuedNotice(null);
    replyKeyRef.current = null;
    queuedMessageRef.current = null;
    setSelectedId(conversationId);
    setMobileThreadOpen(true);
  }

  async function loadOlderMessages() {
    if (
      !selectedId ||
      !messageCursor ||
      olderLoading ||
      !messagesPaneRef.current
    )
      return;
    const pane = messagesPaneRef.current;
    const before = { top: pane.scrollTop, height: pane.scrollHeight };
    setOlderLoading(true);
    setHistoryError(null);
    try {
      const path = inboxPath(
        businessId,
        `/${encodeURIComponent(selectedId)}/messages?limit=30&cursor=${encodeURIComponent(messageCursor)}`,
      );
      const page = await getInboxJson<CursorPage<InboxMessage>>(path);
      if (selectedRef.current !== selectedId) return;
      pendingRestoreRef.current = before;
      setMessages((current) => mergeMessages(page.items, current));
      setMessageCursor(page.nextCursor);
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : 'Older messages could not be loaded.',
      );
    } finally {
      setOlderLoading(false);
    }
  }

  async function changeControl(target: InboxMode) {
    if (!selectedId || controlPending) return;
    setControlPending(true);
    setControlError(null);
    setReleaseConfirmation(false);
    try {
      const response = await getInboxJson<{
        mode: InboxMode;
        controlVersion: number;
        changedAt: string;
        changed: boolean;
      }>(
        inboxPath(
          businessId,
          `/${encodeURIComponent(selectedId)}/${target === 'HUMAN' ? 'takeover' : 'release'}`,
        ),
        { method: 'POST' },
      );
      if (selectedRef.current !== selectedId) return;
      setDetail((current) =>
        current
          ? {
              ...current,
              control_mode: response.mode,
              control_version: response.controlVersion,
              control_changed_at: response.changedAt,
            }
          : current,
      );
      setConversations((current) =>
        current.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                control_mode: response.mode,
                control_version: response.controlVersion,
              }
            : item,
        ),
      );
    } catch (error) {
      setControlError(
        error instanceof Error
          ? error.message
          : 'Conversation control could not be changed.',
      );
    } finally {
      setControlPending(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedId || !text || mode !== 'HUMAN' || sending) return;
    const key =
      replyKeyRef.current?.text === text && replyKeyRef.current.key
        ? replyKeyRef.current.key
        : window.crypto.randomUUID();
    replyKeyRef.current = { text, key };
    setSending(true);
    setReplyError(null);
    setQueuedNotice(null);
    try {
      const result = await getInboxJson<{
        outboundMessageId: string;
        status: 'QUEUED';
      }>(inboxPath(businessId, `/${encodeURIComponent(selectedId)}/replies`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ text }),
      });
      if (result.status !== 'QUEUED')
        throw new InboxRequestError(
          500,
          'unavailable',
          'The reply could not be queued.',
        );
      if (selectedRef.current !== selectedId) return;
      setMessages((current) =>
        mergeMessages(current, [
          {
            id: result.outboundMessageId,
            direction: 'outbound',
            content: text,
            status: result.status,
            provider_message_id: null,
            created_at: new Date().toISOString(),
            authorization_kind: 'HUMAN',
            error_classification: null,
          },
        ]),
      );
      queuedMessageRef.current = result.outboundMessageId;
      setDraft('');
      replyKeyRef.current = null;
      setQueuedNotice(
        'Reply queued. Delivery status will update here; it has not been confirmed as delivered yet.',
      );
      nearBottomRef.current = true;
      pendingBottomRef.current = true;
      void refreshListRef.current(false);
    } catch (error) {
      setReplyError(
        error instanceof Error
          ? error.message
          : 'The reply could not be sent. Your draft is still here.',
      );
    } finally {
      setSending(false);
    }
  }

  const loadingError = listError && conversations.length === 0;

  return (
    <section className={styles.inbox} aria-label="Merchant conversation inbox">
      <div
        className={`${styles.listPanel} ${mobileThreadOpen ? styles.mobileListHidden : ''}`}
      >
        <div className={styles.listHeader}>
          <div>
            <h2>Inbox</h2>
            <p>WhatsApp conversations</p>
          </div>
          <span className={styles.count}>{conversations.length}</span>
        </div>
        {loadingError ? (
          <div className={styles.listState} role="alert">
            <strong>Inbox unavailable</strong>
            <p>{listError.message}</p>
            <button
              className="button button-secondary"
              onClick={() => void refreshList(false)}
            >
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className={styles.listState}>
            <span className={styles.emptyGlyph} aria-hidden="true">
              ◌
            </span>
            <strong>No conversations yet</strong>
            <p>
              New customer messages will appear here after WhatsApp is
              connected.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.conversationList} aria-label="Conversations">
              {conversations.map((conversation) => {
                const active = conversation.id === selectedId;
                return (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`${styles.conversationRow} ${active ? styles.selectedRow : ''}`}
                    aria-pressed={active}
                    onClick={() => void selectConversation(conversation.id)}
                  >
                    <span className={styles.customerAvatar} aria-hidden="true">
                      {displayName(conversation)
                        .slice(0, 1)
                        .toLocaleUpperCase()}
                    </span>
                    <span className={styles.rowBody}>
                      <span className={styles.rowTop}>
                        <strong>{displayName(conversation)}</strong>
                        <time dateTime={conversation.last_activity}>
                          {formatInboxTime(conversation.last_activity)}
                        </time>
                      </span>
                      <span className={styles.rowPreview}>
                        {conversation.preview || 'No message preview'}
                      </span>
                      <span className={styles.rowMeta}>
                        <span>
                          {conversation.control_mode === 'HUMAN'
                            ? 'HUMAN'
                            : 'AUTO'}
                        </span>
                        {conversation.handoff_needed && (
                          <span className={styles.handoffNeeded}>
                            Needs follow-up
                          </span>
                        )}
                        {Number(conversation.in_flight) > 0 && (
                          <span className={styles.inFlight}>
                            Sending · {conversation.in_flight}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {listCursor && (
              <button
                className={styles.moreButton}
                type="button"
                disabled={listLoading}
                onClick={() => void refreshList(true)}
              >
                {listLoading ? 'Loading…' : 'Load more conversations'}
              </button>
            )}
            {listError && (
              <p className={styles.inlineError} role="status">
                {listError.message}
              </p>
            )}
          </>
        )}
      </div>

      <div
        className={`${styles.threadPanel} ${mobileThreadOpen ? styles.mobileThreadOpen : ''}`}
      >
        {!selectedId ? (
          <div className={styles.noSelection}>
            <span className={styles.emptyGlyph} aria-hidden="true">
              ◌
            </span>
            <h2>Select a conversation</h2>
            <p>
              Choose a customer from the inbox to read messages and manage
              automation.
            </p>
          </div>
        ) : (
          <>
            <header className={styles.threadHeader}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => setMobileThreadOpen(false)}
                aria-label="Back to conversations"
              >
                ← <span>Inbox</span>
              </button>
              <div className={styles.threadCustomer}>
                <span className={styles.customerAvatar} aria-hidden="true">
                  {displayName(
                    detail ??
                      selectedConversation ?? {
                        customer_name: '',
                        customer_whatsapp_id: '',
                      },
                  )
                    .slice(0, 1)
                    .toLocaleUpperCase()}
                </span>
                <div>
                  <h2>
                    {detail
                      ? displayName(detail)
                      : selectedConversation
                        ? displayName(selectedConversation)
                        : 'Loading conversation'}
                  </h2>
                  <p>
                    {detail?.customer_whatsapp_id ??
                      selectedConversation?.customer_whatsapp_id ??
                      ''}
                  </p>
                </div>
              </div>
              <div className={styles.threadControls}>
                <span
                  className={`${styles.modePill} ${mode === 'HUMAN' ? styles.humanMode : styles.autoMode}`}
                >
                  <i /> {modeLabel(mode)}
                </span>
                {mode === 'AUTO' ? (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={controlPending || !detail}
                    onClick={() => void changeControl('HUMAN')}
                  >
                    {controlPending ? 'Taking over…' : 'Take over conversation'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={controlPending || !detail}
                    onClick={() => setReleaseConfirmation(true)}
                  >
                    {controlPending ? 'Resuming…' : 'Resume automation'}
                  </button>
                )}
              </div>
            </header>
            {releaseConfirmation && mode === 'HUMAN' && (
              <div
                className={styles.humanNotice}
                role="group"
                aria-label="Confirm resuming automation"
              >
                <p>Resume automated replies for this conversation?</p>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setReleaseConfirmation(false)}
                >
                  Keep human control
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={controlPending}
                  onClick={() => void changeControl('AUTO')}
                >
                  Confirm resume automation
                </button>
              </div>
            )}
            {mode === 'HUMAN' && (
              <div className={styles.humanNotice} role="status">
                <strong>Automation is paused.</strong> You’re replying as a
                person.{' '}
                {inFlight > 0 && (
                  <span>
                    {inFlight} message{inFlight === 1 ? ' is' : 's are'} already
                    in flight and may still complete.
                  </span>
                )}
              </div>
            )}
            {controlError && (
              <p className={styles.inlineError} role="alert">
                {controlError}
              </p>
            )}
            <div
              className={styles.messageArea}
              ref={messagesPaneRef}
              onScroll={(event) => {
                const pane = event.currentTarget;
                nearBottomRef.current =
                  pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100;
              }}
              aria-label="Message history"
            >
              {messageCursor && (
                <div className={styles.olderControl}>
                  <button
                    className={styles.moreButton}
                    type="button"
                    disabled={olderLoading}
                    onClick={() => void loadOlderMessages()}
                  >
                    {olderLoading
                      ? 'Loading older messages…'
                      : 'Load older messages'}
                  </button>
                </div>
              )}
              {historyError && (
                <p className={styles.inlineError} role="alert">
                  {historyError}
                </p>
              )}
              {threadLoading ? (
                <div className={styles.threadState} role="status">
                  Loading messages…
                </div>
              ) : threadError ? (
                <div className={styles.threadState} role="alert">
                  <strong>Conversation unavailable</strong>
                  <p>{threadError}</p>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setThreadRequestVersion((value) => value + 1)
                    }
                  >
                    Try again
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className={styles.threadState}>
                  <strong>No messages yet</strong>
                  <p>The conversation history is empty.</p>
                </div>
              ) : (
                <div
                  className={styles.messageStack}
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  {messages.map((message) => {
                    const inbound = message.direction === 'inbound';
                    const failure = messageFailureText(message);
                    return (
                      <article
                        key={message.id}
                        className={`${styles.messageRow} ${inbound ? styles.inboundRow : styles.outboundRow}`}
                      >
                        <div
                          className={`${styles.messageBubble} ${inbound ? styles.inboundBubble : styles.outboundBubble}`}
                        >
                          <div className={styles.messageLabel}>
                            <span>{senderLabel(message)}</span>
                            <time dateTime={message.created_at}>
                              {formatInboxTime(message.created_at)}
                            </time>
                          </div>
                          <p>{message.content}</p>
                          {!inbound && (
                            <div
                              className={`${styles.messageStatus} ${failure ? styles.failedStatus : ''}`}
                              aria-label={`Message status: ${messageStatusLabel(message.status)}`}
                            >
                              <span>{messageStatusLabel(message.status)}</span>
                              {failure && <span> · {failure}</span>}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            <footer className={styles.composerArea}>
              {queuedNotice && (
                <p className={styles.queuedNotice} role="status">
                  {queuedNotice}
                </p>
              )}
              {replyError && (
                <p className={styles.inlineError} role="alert">
                  {replyError}
                </p>
              )}
              {mode === 'HUMAN' ? (
                <form className={styles.composer} onSubmit={sendReply}>
                  <label
                    className={styles.visuallyHidden}
                    htmlFor="manual-reply"
                  >
                    Write a reply
                  </label>
                  <textarea
                    id="manual-reply"
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setReplyError(null);
                      setQueuedNotice(null);
                    }}
                    maxLength={4096}
                    rows={2}
                    placeholder="Write a WhatsApp reply…"
                    disabled={sending}
                  />
                  <div className={styles.composerTools}>
                    <span>{draft.length.toLocaleString()} / 4,096</span>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={sending || !draft.trim()}
                    >
                      {sending ? 'Queuing…' : 'Send reply'}{' '}
                      <span aria-hidden="true">↑</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.composerDisabled}>
                  <span aria-hidden="true">⌑</span>
                  <p>Take over this conversation to send a manual reply.</p>
                </div>
              )}
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
