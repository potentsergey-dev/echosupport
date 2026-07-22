import { useEffect, useState } from 'preact/hooks';
import { isOpen, apiBase, agentKey, agentInfo, proactivePrompt } from './signals';
import { initSession, connectVisitorWs, disconnectVisitorWs } from './api';
import { LauncherButton } from './components/LauncherButton';
import { ChatWindow } from './components/ChatWindow';
import { ProactivePrompt } from './components/ProactivePrompt';
import { t } from './i18n';

interface WidgetProps {
  apiBase: string;
  agentKey: string;
}

function getUrlLaunchOptions() {
  if (typeof window === 'undefined') return { autoOpen: false, fullscreen: false };

  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const chatMode = searchParams.get('chat') ?? hashParams.get('chat');
  const displayMode = searchParams.get('display') ?? hashParams.get('display');
  const autoOpen = chatMode === 'open';
  const isTouchSize = window.matchMedia('(max-width: 1024px)').matches;

  return {
    autoOpen,
    fullscreen: autoOpen && (displayMode === 'fullscreen' || isTouchSize),
  };
}

export function Widget({ apiBase: base, agentKey: key }: WidgetProps) {
  const [initError, setInitError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
    // Set globals synchronously before initSession reads them
    apiBase.value = base;
    agentKey.value = key;

    const launchOptions = getUrlLaunchOptions();
    setFullscreen(launchOptions.fullscreen);
    if (launchOptions.autoOpen) {
      proactivePrompt.value = null;
      isOpen.value = true;
    }

    initSession()
      .then(() => {
        // Connect WebSocket for operator messages after session created
        connectVisitorWs();
        const agent = agentInfo.value;
        if (agent?.proactiveMessageDelay && agent.proactiveMessageText) {
          proactiveTimer = setTimeout(() => {
            if (!isOpen.value) proactivePrompt.value = agent.proactiveMessageText;
          }, agent.proactiveMessageDelay * 1000);
        }
      })
      .catch((err) => setInitError(err instanceof Error ? err.message : 'Init error'))
      .finally(() => setLoading(false));

    return () => {
      if (proactiveTimer) clearTimeout(proactiveTimer);
      proactivePrompt.value = null;
      disconnectVisitorWs();
    };
  }, [base, key]);

  if (loading) return null;

  if (initError) {
    console.error('[EchoSupport] Widget init error:', initError);
    return (
      <div class="fixed bottom-4 left-4 right-4 z-[9998] rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-xl sm:bottom-6 sm:left-auto sm:right-6 sm:w-80">
        <p class="font-semibold text-red-700">{t('chatUnavailable')}</p>
        <p class="mt-1 text-xs text-gray-500">{initError}</p>
      </div>
    );
  }

  return (
    <>
      {isOpen.value && (
        <ChatWindow
          fullscreen={fullscreen}
          onClose={() => {
            isOpen.value = false;
          }}
        />
      )}
      {!isOpen.value && (
        <>
          <ProactivePrompt
            onClick={() => {
              proactivePrompt.value = null;
              isOpen.value = true;
            }}
          />
          <LauncherButton
            onClick={() => {
              proactivePrompt.value = null;
              isOpen.value = true;
            }}
          />
        </>
      )}
    </>
  );
}
