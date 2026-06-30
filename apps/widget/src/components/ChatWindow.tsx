import {
  agentInfo,
  messages,
  isTyping,
  sessionStatus,
  operatorTyping,
  handoffPending,
  csatDone,
  quickReplies,
} from '../signals';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { MessageInput } from './MessageInput';
import { sendMessage } from '../api';
import { CsatForm } from './CsatForm';
import { QuickReplies } from './QuickReplies';

export function ChatWindow({ onClose }: { onClose: () => void }) {
  const agent = agentInfo.value;
  const status = sessionStatus.value;
  const isResolved = status === 'RESOLVED' || status === 'CLOSED';

  // Status badge in header
  const statusBadge = (() => {
    if (status === 'WAITING_OPERATOR')
      return { text: 'Ожидание оператора', color: 'bg-yellow-400' };
    if (status === 'WITH_OPERATOR') return { text: 'С оператором', color: 'bg-green-400' };
    return null;
  })();

  return (
    <div
      class="fixed bottom-4 left-4 right-4 z-[9998] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:bottom-6 sm:left-auto sm:right-6 sm:w-96"
      style={{ height: 'min(520px, calc(100svh - 2rem))' }}
    >
      {/* Header */}
      <div class="flex items-center gap-3 bg-indigo-600 px-4 py-3 text-white">
        {agent?.avatarUrl ? (
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            class="h-9 w-9 flex-shrink-0 rounded-full object-cover"
          />
        ) : (
          <div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            {agent?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div class="flex-1 min-w-0">
          <p class="truncate text-sm font-semibold">{agent?.name ?? 'Support'}</p>
          {statusBadge ? (
            <span
              class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-gray-900 ${statusBadge.color}`}
            >
              <span class="h-1.5 w-1.5 rounded-full bg-white inline-block" />
              {statusBadge.text}
            </span>
          ) : agent?.role ? (
            <p class="truncate text-xs text-indigo-200">{agent.role}</p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          class="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          title="Close"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width={2}
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Handoff pending banner */}
      {handoffPending.value && (
        <div class="flex items-center gap-2 bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <span class="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          <p class="text-xs text-yellow-800">Ищем свободного оператора…</p>
        </div>
      )}

      {/* Messages */}
      <div class="flex-1 overflow-y-auto bg-gray-50">
        <MessageList messages={messages.value} />
        {isTyping.value && <TypingIndicator agentName={agent?.name ?? 'Agent'} />}
        {operatorTyping.value && (
          <div class="flex items-end gap-2 px-4 py-1">
            <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">
              O
            </div>
            <div class="rounded-2xl rounded-bl-sm bg-emerald-50 border border-emerald-200 px-3.5 py-2">
              <span class="flex gap-1 items-center">
                <span
                  class="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  class="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  class="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* CSAT — shown when session is resolved */}
      {isResolved && !csatDone.value && <CsatForm />}
      {isResolved && csatDone.value && (
        <div class="border-t border-gray-200 bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">
          Спасибо за оценку!
        </div>
      )}

      {/* Input */}
      {!isResolved && quickReplies.value.length > 0 && (
        <QuickReplies onSelect={(text) => void sendMessage(text)} />
      )}
      {!isResolved && <MessageInput onSend={(text) => void sendMessage(text)} />}
    </div>
  );
}
