import {
  apiBase,
  agentKey,
  sessionId,
  agentInfo,
  messages,
  isTyping,
  sessionStatus,
  operatorTyping,
  handoffPending,
  quickReplies,
  csatDone,
} from './signals';
import type {
  SseDeltaEvent,
  SseDoneEvent,
  SseErrorEvent,
  SseQuickRepliesEvent,
  WsVisitorEvent,
} from './types';
import { getWidgetLanguage, t } from './i18n';

const VISITOR_KEY = 'es_visitor_id';

function getVisitorId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(VISITOR_KEY);
  } catch {
    // Storage can be blocked in privacy-restricted embedded contexts.
  }
  if (!id) {
    // Simple uuid-v4 without external library
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    try {
      localStorage.setItem(VISITOR_KEY, id);
    } catch {
      // Non-persistent visitor IDs still allow the widget to function.
    }
  }
  return id;
}

function getApiBase(): string {
  return apiBase.value.replace(/\/+$/, '');
}

function friendlyApiError(message: string, status?: number): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('origin not allowed')) return t('errorOriginNotAllowed');
  if (
    normalized.includes('missing x-agent-key') ||
    normalized.includes('missing sessionid or agentkey')
  ) {
    return t('errorMissingAgentKey');
  }
  if (normalized.includes('agent not found') || normalized.includes('agent is inactive')) {
    return t('errorAgentUnavailable');
  }
  if (normalized.includes('no llm api key') || normalized.includes('openrouter api key')) {
    return t('errorMissingLlmKey');
  }
  if (normalized.includes('no embedding api key')) return t('errorMissingEmbeddingKey');
  if (
    status === 429 ||
    normalized.includes('too many requests') ||
    normalized.includes('rate limit')
  ) {
    return t('errorRateLimited');
  }
  if (status && status >= 500) return t('errorServerSetup');

  return message;
}

async function parseErrorResponse(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const error = body?.error;

  if (typeof error === 'string' && error.trim()) return friendlyApiError(error, res.status);

  if (error && typeof error === 'object') {
    const fieldErrors = Object.entries(error as Record<string, unknown>)
      .flatMap(([field, value]) => {
        if (!Array.isArray(value)) return [];
        return value
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((message) => `${field}: ${message}`);
      })
      .join('; ');
    if (fieldErrors) return friendlyApiError(fieldErrors, res.status);
  }

  return friendlyApiError(fallback, res.status);
}

function getPageContext(): { pageUrl?: string; pageReferrer?: string } {
  const pageUrl = window.location.href;
  const pageReferrer = document.referrer;
  return {
    ...(pageUrl.length <= 2000 ? { pageUrl } : {}),
    ...(pageReferrer.length <= 2000 ? { pageReferrer } : {}),
  };
}

export async function initSession(): Promise<void> {
  const visitorId = getVisitorId();
  const res = await fetch(`${getApiBase()}/api/v1/public/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': agentKey.value,
    },
    body: JSON.stringify({ visitorId, language: getWidgetLanguage(), ...getPageContext() }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, t('createSessionFailed')));
  }

  const data = (await res.json()) as {
    sessionId: string;
    agent: {
      name: string;
      role: string | null;
      avatarUrl: string | null;
      greetingMessage: string | null;
      proactiveMessageDelay: number | null;
      proactiveMessageText: string | null;
      language?: string | null;
    };
  };

  sessionId.value = data.sessionId;
  agentInfo.value = data.agent;
  sessionStatus.value = 'ACTIVE';
  handoffPending.value = false;
  operatorTyping.value = false;
  quickReplies.value = [];
  csatDone.value = false;

  if (data.agent.greetingMessage) {
    messages.value = [{ id: 'greeting', role: 'assistant', text: data.agent.greetingMessage }];
  }
}

export async function sendMessage(text: string): Promise<void> {
  const sid = sessionId.value;
  if (!sid || isTyping.value) return;
  quickReplies.value = [];
  const expectsAssistant = sessionStatus.value === 'ACTIVE';

  // Add user message immediately
  messages.value = [...messages.value, { id: `u-${Date.now()}`, role: 'user', text }];
  isTyping.value = expectsAssistant;

  const assistantId = `a-${Date.now()}`;
  if (expectsAssistant) {
    messages.value = [...messages.value, { id: assistantId, role: 'assistant', text: '' }];
  }

  try {
    const res = await fetch(`${getApiBase()}/api/v1/public/sessions/${sid}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Key': agentKey.value,
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok || !res.body) {
      throw new Error(await parseErrorResponse(res, `Request failed: ${res.status}`));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantText = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const chunk of parts) {
        const lines = chunk.split('\n');
        let eventName = '';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) eventName = line.slice(7).trim();
          if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
        }

        if (!dataStr) continue;

        try {
          const payload: unknown = JSON.parse(dataStr);

          if (eventName === 'delta' && expectsAssistant) {
            const delta = payload as SseDeltaEvent;
            assistantText += delta.text;
            messages.value = messages.value.map((m) =>
              m.id === assistantId ? { ...m, text: assistantText } : m,
            );
          } else if (eventName === 'done') {
            const doneEvt = payload as SseDoneEvent;
            // Use the full text from the done event as the authoritative value
            if (expectsAssistant) {
              messages.value = messages.value.map((m) =>
                m.id === assistantId ? { ...m, text: doneEvt.fullText } : m,
              );
            }
            if (doneEvt.handoffRequested) {
              handoffPending.value = true;
              sessionStatus.value = 'WAITING_OPERATOR';
              // Add system message about handoff
              messages.value = [
                ...messages.value,
                {
                  id: `sys-${Date.now()}`,
                  role: 'system',
                  text: t('handoffRequested'),
                },
              ];
            }
          } else if (eventName === 'quick_replies') {
            const event = payload as SseQuickRepliesEvent;
            quickReplies.value = event.replies;
          } else if (eventName === 'error') {
            const err = payload as SseErrorEvent;
            messages.value = messages.value.map((m) =>
              m.id === assistantId ? { ...m, text: `⚠️ ${err.message}` } : m,
            );
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } catch (err) {
    if (expectsAssistant) {
      messages.value = messages.value.map((m) =>
        m.id === assistantId
          ? { ...m, text: `⚠️ ${err instanceof Error ? err.message : t('connectionError')}` }
          : m,
      );
    } else {
      messages.value = [
        ...messages.value,
        {
          id: `sys-${Date.now()}`,
          role: 'system',
          text: err instanceof Error ? err.message : t('connectionError'),
        },
      ];
    }
  } finally {
    isTyping.value = false;
  }
}

export async function sendAudio(audioBlob: Blob, mimeType: string): Promise<string> {
  const sid = sessionId.value;
  if (!sid) throw new Error(t('noActiveSession'));

  const form = new FormData();
  form.append('audio', audioBlob, `recording.${mimeType.split('/')[1] ?? 'webm'}`);

  const res = await fetch(`${getApiBase()}/api/v1/public/sessions/${sid}/stt`, {
    method: 'POST',
    headers: { 'X-Agent-Key': agentKey.value },
    body: form,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(friendlyApiError(body.error ?? t('transcriptionFailed'), res.status));
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}

// ── WebSocket for operator messages ──────────────────────────────────────────

let visitorWs: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectVisitorWs(): void {
  const sid = sessionId.value;
  const key = agentKey.value;
  const base = apiBase.value;
  if (!sid || !key) return;

  // Derive WebSocket URL from apiBase
  const url = new URL(base || window.location.origin);
  const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${url.host}/api/v1/ws/visitor?sessionId=${encodeURIComponent(sid)}&agentKey=${encodeURIComponent(key)}`;

  const ws = new WebSocket(wsUrl);
  visitorWs = ws;

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WsVisitorEvent;

      if (event.type === 'operator:message' && event.sessionId === sid) {
        messages.value = [
          ...messages.value,
          { id: `op-${Date.now()}`, role: 'operator', text: event.content },
        ];
        operatorTyping.value = false;
      } else if (event.type === 'operator:typing_visitor' && event.sessionId === sid) {
        operatorTyping.value = event.typing;
      } else if (event.type === 'operator:joined' && event.sessionId === sid) {
        sessionStatus.value = 'WITH_OPERATOR';
        handoffPending.value = false;
        messages.value = [
          ...messages.value,
          {
            id: `sys-${Date.now()}`,
            role: 'system',
            text: event.operatorName
              ? t('operatorJoinedNamed', { name: event.operatorName })
              : t('operatorJoined'),
          },
        ];
      } else if (event.type === 'session:status' && event.sessionId === sid) {
        sessionStatus.value = event.status;
      }
    } catch {
      // ignore malformed frames
    }
  };

  ws.onclose = () => {
    visitorWs = null;
    // Reconnect if session still active
    if (sessionId.value && sessionStatus.value !== 'CLOSED' && sessionStatus.value !== 'RESOLVED') {
      wsReconnectTimer = setTimeout(connectVisitorWs, 5000);
    }
  };
}

export function disconnectVisitorWs(): void {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  visitorWs?.close();
  visitorWs = null;
}

export async function closeSession(): Promise<void> {
  const sid = sessionId.value;
  if (!sid) throw new Error(t('noActiveSession'));
  const res = await fetch(`${getApiBase()}/api/v1/public/sessions/${sid}/close`, {
    method: 'POST',
    headers: { 'X-Agent-Key': agentKey.value },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    const message = typeof body.error === 'string' ? body.error : t('closeSessionFailed');
    throw new Error(friendlyApiError(message, res.status));
  }
  sessionStatus.value = 'CLOSED';
  handoffPending.value = false;
  operatorTyping.value = false;
  quickReplies.value = [];
  isTyping.value = false;
  disconnectVisitorWs();
}

export async function startNewSession(): Promise<void> {
  disconnectVisitorWs();
  sessionId.value = null;
  messages.value = [];
  quickReplies.value = [];
  handoffPending.value = false;
  operatorTyping.value = false;
  isTyping.value = false;
  csatDone.value = false;
  sessionStatus.value = 'ACTIVE';
  await initSession();
  connectVisitorWs();
}
export async function submitCsat(rating: 1 | -1, comment?: string): Promise<void> {
  const sid = sessionId.value;
  if (!sid) throw new Error(t('noActiveSession'));
  const normalizedComment = comment?.trim();
  const res = await fetch(`${getApiBase()}/api/v1/public/sessions/${sid}/csat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': agentKey.value,
    },
    body: JSON.stringify({ rating, ...(normalizedComment ? { comment: normalizedComment } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    const message = typeof body.error === 'string' ? body.error : t('submitRatingFailed');
    throw new Error(friendlyApiError(message, res.status));
  }
}
