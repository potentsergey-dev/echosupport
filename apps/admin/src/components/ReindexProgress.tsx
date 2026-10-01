import { useEffect, useRef, useState } from 'react';
import { getJob, getJobStreamUrl } from '../lib/api';
import type { JobStatus } from '../types';

export interface JobResult {
  status: JobStatus;
  errorMessage?: string | null;
}
const terminal = new Set(['DONE', 'FAILED', 'CANCELLED']);

export function ReindexProgress({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone: (result: JobResult) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const callback = useRef(onDone);
  callback.current = onDone;

  useEffect(() => {
    let stopped = false;
    let polling = false;
    const controller = new AbortController();
    const es = new EventSource(getJobStreamUrl(jobId), { withCredentials: true });
    setProgress(0);
    setReconnecting(false);
    const accept = (data: JobResult & { progress?: number }) => {
      if (stopped) return;
      if (typeof data.progress === 'number') setProgress(data.progress);
      if (terminal.has(data.status)) {
        stopped = true;
        es.close();
        clearInterval(timer);
        callback.current(data);
      }
    };
    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        accept(await getJob(jobId, controller.signal));
      } catch {
        if (!stopped) setReconnecting(true);
      } finally {
        polling = false;
      }
    };
    const readEvent = (event: Event) => {
      try {
        accept(
          JSON.parse((event as MessageEvent<string>).data) as JobResult & { progress?: number },
        );
      } catch {
        setReconnecting(true);
        void poll();
      }
    };
    es.addEventListener('progress', readEvent);
    es.addEventListener('done', readEvent);
    es.addEventListener('open', () => {
      if (!stopped) setReconnecting(false);
    });
    es.addEventListener('error', () => {
      if (stopped) return;
      // EventSource reconnects itself; transport failure is never a terminal Job result.
      setReconnecting(true);
      void poll();
    });
    const timer = setInterval(() => {
      void poll();
    }, 5_000);
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      es.close();
    };
  }, [jobId]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4" role="status">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">Индексация…</span>
        <span className="text-gray-500">{progress}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      {reconnecting && (
        <p className="mt-2 text-sm text-gray-600">Переподключаемся. Проверяем статус индексации…</p>
      )}
    </div>
  );
}
