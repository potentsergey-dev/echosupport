import { useEffect, useRef } from 'preact/hooks';
import type { Message } from '../types';
import { agentInfo } from '../signals';

function UserBubble({ text }: { text: string }) {
  return (
    <div class="flex justify-end px-4 py-1">
      <div class="max-w-[75%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({
  text,
  agentName,
  avatarUrl,
}: {
  text: string;
  agentName: string;
  avatarUrl: string | null;
}) {
  return (
    <div class="flex items-end gap-2 px-4 py-1">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={agentName}
          class="h-6 w-6 flex-shrink-0 rounded-full object-cover"
        />
      ) : (
        <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
          {agentName[0]?.toUpperCase()}
        </div>
      )}
      <div class="max-w-[75%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-gray-800 shadow-sm">
        {text || (
          <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
        )}
      </div>
    </div>
  );
}

function OperatorBubble({ text }: { text: string }) {
  return (
    <div class="flex items-end gap-2 px-4 py-1">
      <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">
        O
      </div>
      <div class="max-w-[75%] rounded-2xl rounded-bl-sm bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-sm text-gray-800 shadow-sm">
        <p class="text-[10px] font-semibold text-emerald-600 mb-0.5">Оператор</p>
        {text}
      </div>
    </div>
  );
}

function SystemBubble({ text }: { text: string }) {
  return (
    <div class="flex justify-center px-4 py-1">
      <span class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">{text}</span>
    </div>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const agent = agentInfo.value;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div class="space-y-1 py-3">
      {messages.map((msg) => {
        if (msg.role === 'user') return <UserBubble key={msg.id} text={msg.text} />;
        if (msg.role === 'operator') return <OperatorBubble key={msg.id} text={msg.text} />;
        if (msg.role === 'system') return <SystemBubble key={msg.id} text={msg.text} />;
        return (
          <AssistantBubble
            key={msg.id}
            text={msg.text}
            agentName={agent?.name ?? 'Agent'}
            avatarUrl={agent?.avatarUrl ?? null}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
