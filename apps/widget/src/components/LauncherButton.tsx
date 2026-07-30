import { agentInfo } from '../signals';
import { t } from '../i18n';

export function LauncherButton({ onClick }: { onClick: () => void }) {
  const agent = agentInfo.value;
  const hasAvatar = Boolean(agent?.avatarUrl);

  return (
    <button
      onClick={onClick}
      title={agent ? t('launcherOpenChatWith', { name: agent.name }) : t('launcherOpenChat')}
      class={`fixed bottom-24 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        hasAvatar
          ? 'overflow-hidden bg-white ring-2 ring-white/90 hover:bg-white'
          : 'bg-indigo-600 hover:bg-indigo-700'
      }`}
    >
      {agent?.avatarUrl ? (
        <img
          src={agent.avatarUrl}
          alt={agent.name}
          class="block h-full w-full rounded-full bg-white object-cover"
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
