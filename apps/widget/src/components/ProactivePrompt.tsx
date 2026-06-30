import { proactivePrompt } from '../signals';

export function ProactivePrompt({ onClick }: { onClick: () => void }) {
  if (!proactivePrompt.value) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      class="fixed bottom-40 right-6 z-[9999] max-w-72 rounded-2xl rounded-br-sm bg-white px-4 py-3 text-left text-sm text-gray-800 shadow-xl ring-1 ring-black/5"
    >
      {proactivePrompt.value}
    </button>
  );
}
