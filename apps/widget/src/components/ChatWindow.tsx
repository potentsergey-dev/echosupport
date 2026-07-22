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
import { closeSession, sendMessage, startNewSession } from '../api';
import { CsatForm } from './CsatForm';
import { QuickReplies } from './QuickReplies';
import { t } from '../i18n';
import { useState } from 'preact/hooks';

interface ChatWindowProps {
  fullscreen?: boolean;
  onClose: () => void;
}

export function ChatWindow({ fullscreen = false, onClose }: ChatWindowProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [isStartingNew, setIsStartingNew] = useState(false);
  const [startNewError, setStartNewError] = useState('');
  const agent = agentInfo.value;
  const status = sessionStatus.value;
  const isResolved = status === 'RESOLVED' || status === 'CLOSED';
  const containerClass = fullscreen
    ? 'fixed inset-0 z-[9998] flex flex-col overflow-hidden bg-white shadow-2xl'
    : 'fixed bottom-4 left-4 right-4 z-[9998] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:bottom-6 sm:left-auto sm:right-6 sm:w-96';
  const containerStyle = fullscreen
    ? { height: '100svh' }
    : { height: 'min(520px, calc(100svh - 2rem))' };

  async function handleEndChat() {
    if (isClosing || isResolved) return;
    setIsClosing(true);
    setCloseError('');
    try {
      await closeSession();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : t('closeSessionFailed'));
    } finally {
      setIsClosing(false);
    }
  }

  async function handleStartNewChat() {
    if (isStartingNew) return;
    setIsStartingNew(true);
    setStartNewError('');
    try {
      await startNewSession();
    } catch (err) {
      setStartNewError(err instanceof Error ? err.message : t('startNewChatFailed'));
    } finally {
      setIsStartingNew(false);
    }
  }

  // Status badge in header
  const statusBadge = (() => {
    if (status === 'WAITING_OPERATOR')
      return { text: t('waitingOperator'), color: 'bg-yellow-400' };
    if (status === 'WITH_OPERATOR') return { text: t('withOperator'), color: 'bg-green-400' };
    return null;
  })();

  return (
    <div class={containerClass} style={containerStyle}>
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
          <p class="truncate text-sm font-semibold">{agent?.name ?? t('supportFallback')}</p>
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
          title={t('close')}
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
      {handoffPending.value && !isResolved && (
        <div class="flex items-center gap-2 bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <span class="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          <p class="text-xs text-yellow-800">{t('findingOperator')}</p>
        </div>
      )}

      {/* Messages */}
      <div class="flex-1 overflow-y-auto bg-gray-50">
        <MessageList messages={messages.value} />
        {isTyping.value && <TypingIndicator agentName={agent?.name ?? t('agentFallback')} />}
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

      {!isResolved && (
        <div class="border-t border-gray-200 bg-white px-4 py-2">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-gray-400">{t('endChatHint')}</p>
            <button
              type="button"
              onClick={() => void handleEndChat()}
              disabled={isClosing || isTyping.value}
              class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"
            >
              {isClosing ? t('endingChat') : t('endChat')}
            </button>
          </div>
          {closeError && <p class="mt-1 text-xs text-red-600">{closeError}</p>}
        </div>
      )}

      {/* CSAT — shown when session is resolved */}
      {isResolved && !csatDone.value && <CsatForm />}
      {isResolved && csatDone.value && (
        <div class="border-t border-gray-200 bg-gray-50 px-4 py-3 text-center">
          <p class="text-xs text-gray-400">{t('csatThanks')}</p>
          <p class="mt-1 text-xs text-gray-500">{t('chatClosedAfterRating')}</p>
          <button
            type="button"
            onClick={() => void handleStartNewChat()}
            disabled={isStartingNew}
            class="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"
          >
            {isStartingNew ? t('startingNewChat') : t('startNewChat')}
          </button>
          {startNewError && <p class="mt-1 text-xs text-red-600">{startNewError}</p>}
        </div>
      )}

      {/* Input */}
      {!isResolved && quickReplies.value.length > 0 && (
        <QuickReplies onSelect={(text) => void sendMessage(text)} />
      )}
      {!isResolved && <MessageInput onSend={(text) => void sendMessage(text)} />}
      <div class="border-t border-gray-100 bg-white px-4 py-2 text-center text-[11px] leading-none text-gray-400">
        <a
          href="https://github.com/potentsergey-dev/echosupport"
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-indigo-600"
        >
          Powered by EchoSupport
        </a>
      </div>
    </div>
  );
}
