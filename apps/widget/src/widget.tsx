import { useEffect, useState } from 'preact/hooks';
import { isOpen, apiBase, agentKey, agentInfo, proactivePrompt } from './signals';
import { initSession, connectVisitorWs, disconnectVisitorWs } from './api';
import { LauncherButton } from './components/LauncherButton';
import { ChatWindow } from './components/ChatWindow';
import { ProactivePrompt } from './components/ProactivePrompt';

interface WidgetProps {
  apiBase: string;
  agentKey: string;
}

export function Widget({ apiBase: base, agentKey: key }: WidgetProps) {
  const [initError, setInitError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
    // Set globals synchronously before initSession reads them
    apiBase.value = base;
    agentKey.value = key;

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
    return null;
  }

  return (
    <>
      {isOpen.value && (
        <ChatWindow
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
