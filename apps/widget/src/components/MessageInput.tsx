import { useRef } from 'preact/hooks';
import { inputText, isTyping } from '../signals';
import { MicButton } from './MicButton';
import { t } from '../i18n';

export function MessageInput({ onSend }: { onSend: (text: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSend() {
    const text = inputText.value.trim();
    if (!text || isTyping.value) return;
    inputText.value = '';
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e: Event) {
    const ta = e.currentTarget as HTMLTextAreaElement;
    inputText.value = ta.value;
    // Auto-resize
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }

  return (
    <div class="flex items-end gap-2 border-t border-gray-200 bg-white px-3 py-2">
      <textarea
        ref={textareaRef}
        value={inputText.value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={t('messagePlaceholder')}
        rows={1}
        disabled={isTyping.value}
        class="flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
        style={{ maxHeight: '120px', overflowY: 'auto' }}
      />
      <MicButton />
      <button
        onClick={handleSend}
        disabled={!inputText.value.trim() || isTyping.value}
        class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
        title={t('send')}
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width={2}>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
}
