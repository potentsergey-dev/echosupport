import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SendIcon,
  UserCheckIcon,
  CheckIcon,
  RotateCcwIcon,
  LockIcon,
  UnlockIcon,
  SparklesIcon,
} from 'lucide-react';
import {
  listInboxSessions,
  getInboxSession,
  takeSession,
  resolveSession,
  returnToAgent,
  sendOperatorMessage,
  suggestReply,
} from '../lib/api';
import { getToken } from '../lib/auth';
import { useToastContext } from '../components/Layout';
import { Badge } from '../components/ui/Badge';
import type { InboxSession, InboxSessionDetail, SessionStatus } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<SessionStatus, string> = {
  ACTIVE: 'Активна',
  WAITING_OPERATOR: 'Ждёт оператора',
  WITH_OPERATOR: 'С оператором',
  RESOLVED: 'Решена',
  CLOSED: 'Закрыта',
};

const STATUS_VARIANT: Record<SessionStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> =
  {
    ACTIVE: 'default',
    WAITING_OPERATOR: 'warning',
    WITH_OPERATOR: 'info',
    RESOLVED: 'success',
    CLOSED: 'default',
  };

function StatusBadge({ status }: { status: SessionStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

// ── Session List ──────────────────────────────────────────────────────────────

function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: InboxSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-gray-100 overflow-y-auto">
      {sessions.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-gray-400">Нет сессий</p>
      )}
      {sessions.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
            selectedId === s.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">
              {s.visitorName ?? 'Посетитель'}
            </span>
            <StatusBadge status={s.status} />
          </div>
          {s.handoffReason && (
            <p className="mt-0.5 text-xs text-gray-500 truncate">{s.handoffReason}</p>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
            <span>
              {new Date(s.lastActiveAt).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {s.unreadByOperator > 0 && (
              <span className="flex items-center justify-center rounded-full bg-indigo-600 text-white w-4 h-4 text-[10px] font-bold">
                {s.unreadByOperator}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

function ChatPanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [text, setText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: session, isLoading } = useQuery<InboxSessionDetail>({
    queryKey: ['inbox-session', sessionId],
    queryFn: () => getInboxSession(sessionId),
    refetchInterval: 10000,
  });

  // Scroll to bottom when messages load / update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length]);

  const takeMutation = useMutation({
    mutationFn: () => takeSession(sessionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbox-session', sessionId] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const resolveMutation = useMutation({
    mutationFn: () => resolveSession(sessionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbox-session', sessionId] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const returnMutation = useMutation({
    mutationFn: () => returnToAgent(sessionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbox-session', sessionId] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendOperatorMessage(sessionId, { content: text, isInternal }),
    onSuccess: () => {
      setText('');
      void qc.invalidateQueries({ queryKey: ['inbox-session', sessionId] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const suggestMutation = useMutation({
    mutationFn: () => suggestReply(sessionId),
    onSuccess: (data) => setText(data.draft),
    onError: (err) => addToast(err.message, 'error'),
  });

  const handleSend = () => {
    if (!text.trim()) return;
    sendMutation.mutate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!session) return null;

  const canSend = session.status === 'WITH_OPERATOR';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-white">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {session.visitorName ?? 'Посетитель'}
          </p>
          {session.visitorContact && (
            <p className="text-xs text-gray-500">{session.visitorContact}</p>
          )}
          {session.pageUrl && (
            <p className="text-xs text-gray-400 truncate max-w-xs" title={session.pageUrl}>
              {session.pageUrl}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={session.status} />
          {session.status === 'WAITING_OPERATOR' && (
            <button
              onClick={() => takeMutation.mutate()}
              disabled={takeMutation.isPending}
              className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <UserCheckIcon className="h-3.5 w-3.5" />
              Принять
            </button>
          )}
          {session.status === 'WITH_OPERATOR' && (
            <>
              <button
                onClick={() => returnMutation.mutate()}
                disabled={returnMutation.isPending}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <RotateCcwIcon className="h-3.5 w-3.5" />К агенту
              </button>
              <button
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
                className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                <CheckIcon className="h-3.5 w-3.5" />
                Завершить
              </button>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
        {session.messages.map((msg) => {
          const isVisitor = msg.authorType === 'VISITOR';
          const isSystem = msg.authorType === 'SYSTEM';
          const isOp = msg.authorType === 'OPERATOR';

          if (isSystem) {
            return (
              <div key={msg.id} className="text-center text-xs text-gray-400 py-1">
                {msg.content}
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex ${isVisitor ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[70%] rounded-xl px-3 py-2 text-sm ${
                  isVisitor
                    ? 'bg-white border border-gray-200 text-gray-800'
                    : isOp
                      ? msg.isInternal
                        ? 'bg-yellow-50 border border-yellow-200 text-yellow-900'
                        : 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-800'
                }`}
              >
                {msg.isInternal && (
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 opacity-70">
                    Внутренняя заметка
                  </p>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p
                  className={`text-[10px] mt-0.5 ${isVisitor ? 'text-gray-400' : isOp && !msg.isInternal ? 'text-indigo-200' : 'text-gray-400'}`}
                >
                  {new Date(msg.createdAt).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {!isVisitor && ` · ${isOp ? 'Оператор' : 'Агент'}`}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {canSend && (
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setIsInternal((v) => !v)}
              title={isInternal ? 'Внутренняя заметка' : 'Публичный ответ'}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                isInternal ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {isInternal ? <LockIcon className="h-3 w-3" /> : <UnlockIcon className="h-3 w-3" />}
              {isInternal ? 'Внутренняя' : 'Публичная'}
            </button>
            <button
              onClick={() => suggestMutation.mutate()}
              disabled={suggestMutation.isPending}
              title="Предложить ответ от ИИ"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
            >
              <SparklesIcon className="h-3 w-3" />
              {suggestMutation.isPending ? 'Генерация…' : 'Предложить ответ'}
            </button>
          </div>
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Введите сообщение… (Enter — отправить)"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
              className="self-end flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!canSend && session.status !== 'WAITING_OPERATOR' && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">
          {session.status === 'RESOLVED' ? 'Сессия завершена' : 'Только для чтения'}
        </div>
      )}
    </div>
  );
}

// ── Main InboxPage ────────────────────────────────────────────────────────────

export function InboxPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('WAITING_OPERATOR,WITH_OPERATOR');
  const wsRef = useRef<WebSocket | null>(null);

  const { data: sessions = [], isLoading } = useQuery<InboxSession[]>({
    queryKey: ['inbox', statusFilter],
    queryFn: () => {
      const statuses = statusFilter.split(',');
      // Fetch each status separately and merge (API accepts single status)
      return Promise.all(statuses.map((s) => listInboxSessions({ status: s }))).then((results) =>
        results
          .flat()
          .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()),
      );
    },
    refetchInterval: 30000,
  });

  // WebSocket for real-time updates
  const connectWs = useCallback(() => {
    const token = getToken();
    if (!token) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${proto}//${host}/api/v1/ws/operator?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string };
        if (
          event.type === 'session:new' ||
          event.type === 'session:status' ||
          event.type === 'session:message'
        ) {
          void qc.invalidateQueries({ queryKey: ['inbox'] });
          if (selectedId) {
            void qc.invalidateQueries({ queryKey: ['inbox-session', selectedId] });
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      // Reconnect after 5 seconds
      setTimeout(connectWs, 5000);
    };
  }, [qc, selectedId]);

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
    };
  }, [connectWs]);

  const FILTER_OPTIONS = [
    { label: 'Ожидают / С оператором', value: 'WAITING_OPERATOR,WITH_OPERATOR' },
    { label: 'Ожидают ответа', value: 'WAITING_OPERATOR' },
    { label: 'С оператором', value: 'WITH_OPERATOR' },
    { label: 'Решены', value: 'RESOLVED' },
    { label: 'Все активные', value: 'ACTIVE,WAITING_OPERATOR,WITH_OPERATOR' },
  ];

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Входящие</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : (
          <SessionList sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>

      {/* Chat panel */}
      <div className="flex-1 overflow-hidden">
        {selectedId ? (
          <ChatPanel key={selectedId} sessionId={selectedId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Выберите сессию для просмотра
          </div>
        )}
      </div>
    </div>
  );
}
