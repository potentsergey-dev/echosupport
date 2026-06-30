import { agentInfo } from '../signals';

export function LauncherButton({ onClick }: { onClick: () => void }) {
  const agent = agentInfo.value;

  return (
    <button
      onClick={onClick}
      title={agent ? `Chat with ${agent.name}` : 'Open chat'}
      class="fixed bottom-24 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 shadow-lg transition-transform hover:scale-105 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    >
      {agent?.avatarUrl ? (
        <img
          src={agent.avatarUrl}
          alt={agent.name}
          class="h-full w-full rounded-full object-cover"
        />
      ) : (
        <svg
          class="h-7 w-7 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width={2}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      )}
    </button>
  );
}
