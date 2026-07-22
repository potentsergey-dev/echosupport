import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BellRingIcon, XIcon } from 'lucide-react';
import { getRole, getToken } from '../lib/auth';
import { isLiteEdition } from '../lib/app-edition';

type BrowserNotificationStatus = 'unsupported' | 'insecure' | 'default' | 'granted' | 'denied';

const BROWSER_NOTIFICATIONS_KEY = 'es_browser_notifications_enabled';

interface SessionNewEvent {
  type: 'session:new';
  session?: {
    id: string;
    visitorName?: string | null;
    pageUrl?: string | null;
  };
}

interface VisibleNotification {
  visitor: string;
  pageUrl: string | null;
}

interface SessionMessageEvent {
  type: 'session:message';
  sessionId: string;
  message?: {
    authorType?: string;
    content?: string;
  };
}

type OperatorEvent = { type: string } | SessionNewEvent | SessionMessageEvent;

function canReceiveOperatorNotifications(): boolean {
  const role = getRole();
  return role === 'OWNER' || role === 'ADMIN' || role === 'OPERATOR';
}

function getBrowserNotificationStatus(): BrowserNotificationStatus {
  if (!('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return Notification.permission;
}

function isBrowserNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === 'true';
  } catch {
    return false;
  }
}

function setBrowserNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, String(enabled));
  } catch {
    // Ignore storage restrictions; the current permission state still applies.
  }
}

function browserNotificationHelp(status: BrowserNotificationStatus): string {
  if (status === 'unsupported') return 'Этот браузер не поддерживает системные уведомления.';
  if (status === 'insecure') {
    return 'Системные уведомления браузера требуют HTTPS. На HTTP/IP адресе браузер их блокирует.';
  }
  if (status === 'denied') {
    return 'Уведомления заблокированы в браузере. Разрешите их в настройках сайта.';
  }
  return 'Браузер покажет системное уведомление, даже если окно админки свернуто.';
}

function playNotificationSound(): void {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(920, audioContext.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.24);
  oscillator.onended = () => void audioContext.close().catch(() => undefined);
}

export function AdminNotifications({
  addToast,
}: {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [visibleNotification, setVisibleNotification] = useState<VisibleNotification | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [browserNotificationStatus, setBrowserNotificationStatus] =
    useState<BrowserNotificationStatus>(() => getBrowserNotificationStatus());
  const [browserNotificationsEnabled, setBrowserNotificationsEnabledState] = useState(() =>
    isBrowserNotificationsEnabled(),
  );
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldReconnectRef = useRef(true);
  const originalTitleRef = useRef<string>(typeof document !== 'undefined' ? document.title : '');

  const openInbox = useCallback(() => {
    setVisibleNotification(null);
    window.focus();
    navigate('/inbox');
  }, [navigate]);

  const showSystemNotification = useCallback(
    (notification: VisibleNotification) => {
      if (!browserNotificationsEnabled || browserNotificationStatus !== 'granted') return;
      try {
        const systemNotification = new Notification('Новый запрос оператора', {
          body: `${notification.visitor} просит подключить оператора.`,
          tag: 'echosupport-handoff',
          requireInteraction: true,
        });
        systemNotification.onclick = () => {
          systemNotification.close();
          openInbox();
        };
      } catch {
        // Some browsers can still reject notifications depending on OS/browser settings.
      }
    },
    [browserNotificationStatus, browserNotificationsEnabled, openInbox],
  );

  const requestBrowserNotifications = useCallback(async () => {
    const currentStatus = getBrowserNotificationStatus();
    setBrowserNotificationStatus(currentStatus);
    if (
      currentStatus === 'unsupported' ||
      currentStatus === 'insecure' ||
      currentStatus === 'denied'
    ) {
      addToast(browserNotificationHelp(currentStatus), 'error');
      return;
    }

    if (currentStatus === 'granted') {
      setBrowserNotificationsEnabled(true);
      setBrowserNotificationsEnabledState(true);
      addToast('Системные уведомления включены', 'success');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setBrowserNotificationStatus(permission);
      const enabled = permission === 'granted';
      setBrowserNotificationsEnabled(enabled);
      setBrowserNotificationsEnabledState(enabled);
      addToast(
        enabled ? 'Системные уведомления включены' : 'Системные уведомления не включены',
        enabled ? 'success' : 'error',
      );
    } catch {
      addToast('Не удалось запросить разрешение на уведомления', 'error');
    }
  }, [addToast]);

  const flashTitle = useCallback(() => {
    if (typeof document === 'undefined') return;
    const originalTitle = originalTitleRef.current || document.title;
    let showAlert = true;
    if (titleTimerRef.current) clearInterval(titleTimerRef.current);
    document.title = 'Новый запрос оператора';
    titleTimerRef.current = setInterval(() => {
      document.title = showAlert ? originalTitle : 'Новый запрос оператора';
      showAlert = !showAlert;
    }, 1200);
    window.setTimeout(() => {
      if (titleTimerRef.current) {
        clearInterval(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      document.title = originalTitle;
    }, 9000);
  }, []);

  const notifyHandoff = useCallback(
    (event: SessionNewEvent) => {
      const visitor = event.session?.visitorName?.trim() || 'Посетитель';
      const notification = { visitor, pageUrl: event.session?.pageUrl ?? null };
      setVisibleNotification(notification);
      showSystemNotification(notification);
      addToast(`${visitor} просит подключить оператора`, 'info');
      flashTitle();
      try {
        playNotificationSound();
      } catch {
        // Browsers may block audio until the admin has interacted with the page.
      }
    },
    [addToast, flashTitle, showSystemNotification],
  );

  const connect = useCallback(() => {
    const token = getToken();
    if (!token || isLiteEdition || !canReceiveOperatorNotifications()) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/v1/ws/operator?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (messageEvent) => {
      try {
        const event = JSON.parse(messageEvent.data as string) as OperatorEvent;
        if (event.type === 'session:new') {
          notifyHandoff(event as SessionNewEvent);
          void qc.invalidateQueries({ queryKey: ['inbox'] });
          void qc.invalidateQueries({ queryKey: ['sidebar-inbox-summary'] });
        } else if (event.type === 'session:message' || event.type === 'session:status') {
          void qc.invalidateQueries({ queryKey: ['inbox'] });
          void qc.invalidateQueries({ queryKey: ['sidebar-inbox-summary'] });
        }
      } catch {
        // Ignore malformed frames.
      }
    };

    ws.onclose = () => {
      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 5000);
      }
    };
  }, [notifyHandoff, qc]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (titleTimerRef.current) clearInterval(titleTimerRef.current);
      if (originalTitleRef.current) document.title = originalTitleRef.current;
      wsRef.current?.close();
    };
  }, [connect]);

  if (!canReceiveOperatorNotifications() || isLiteEdition) return null;

  const shouldShowSetup =
    !setupDismissed &&
    !(browserNotificationStatus === 'granted' && browserNotificationsEnabled) &&
    !visibleNotification;

  return (
    <>
      {shouldShowSetup && (
        <div className="fixed bottom-4 left-[17rem] z-[9999] max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <BellRingIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Уведомления браузера</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {browserNotificationHelp(browserNotificationStatus)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(browserNotificationStatus === 'default' ||
                  browserNotificationStatus === 'granted') && (
                  <button
                    type="button"
                    onClick={() => void requestBrowserNotifications()}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    Включить
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSetupDismissed(true)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Позже
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSetupDismissed(true)}
              className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Скрыть настройку уведомлений"
            >
              <XIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {visibleNotification && (
        <div className="fixed left-0 right-0 top-0 z-[10000] border-b border-yellow-300 bg-yellow-100 px-4 py-3 shadow-2xl">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-yellow-950">
              <BellRingIcon size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600 shadow-[0_0_0_5px_rgba(220,38,38,0.18)]" />
                <p className="text-base font-bold text-yellow-950">Новый запрос оператора</p>
              </div>
              <p className="mt-0.5 text-sm font-medium text-yellow-900">
                {visibleNotification.visitor} просит подключить оператора.
              </p>
              {visibleNotification.pageUrl && (
                <p
                  className="mt-0.5 truncate text-xs text-yellow-800"
                  title={visibleNotification.pageUrl}
                >
                  {visibleNotification.pageUrl}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={openInbox}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Открыть входящие
              </button>
              <button
                type="button"
                onClick={() => setVisibleNotification(null)}
                className="rounded-lg border border-yellow-400 bg-white px-3 py-2 text-sm font-semibold text-yellow-900 transition-colors hover:bg-yellow-50"
              >
                Скрыть
              </button>
              <button
                type="button"
                onClick={() => setVisibleNotification(null)}
                className="rounded-full p-2 text-yellow-900 transition-colors hover:bg-yellow-200"
                aria-label="Скрыть уведомление"
              >
                <XIcon size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
