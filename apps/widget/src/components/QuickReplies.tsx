import { isTyping, quickReplies } from '../signals';

export function QuickReplies({ onSelect }: { onSelect: (text: string) => void }) {
  if (quickReplies.value.length === 0) return null;

  return (
    <div
      class="flex gap-2 overflow-x-auto border-t border-gray-200 bg-white px-3 py-2"
      aria-label="Варианты ответа"
    >
      {quickReplies.value.map((reply) => (
        <button
          key={reply}
          type="button"
          disabled={isTyping.value}
          onClick={() => onSelect(reply)}
          class="flex-shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
