import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon } from 'lucide-react';
import { listSessions, deleteSession } from '../lib/api';
import { useToastContext } from '../components/Layout';
import { Badge } from '../components/ui/Badge';
import type { Session } from '../types';

export function SessionsPage({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['sessions', agentId],
    queryFn: () => listSessions(agentId),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions', agentId] }),
    onError: (err) => addToast(err.message, 'error'),
  });

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">Сессии</h3>
          <p className="mt-0.5 text-sm text-gray-500">Активные и завершённые сессии посетителей.</p>
        </div>

        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <p className="px-6 py-8 text-center text-sm text-gray-400">Сессий пока нет.</p>
        )}

        {sessions.length > 0 && (
          <div className="divide-y divide-gray-100">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-mono text-gray-700">{s.visitorId}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(s.createdAt).toLocaleString('ru-RU')}
                    {s._count != null && ` · ${s._count.messages} сообщ.`}
                  </p>
                </div>
                <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>
                  {s.status === 'ACTIVE' ? 'Активна' : 'Закрыта'}
                </Badge>
                <p className="text-xs text-gray-400 whitespace-nowrap">
                  до {new Date(s.expiresAt).toLocaleString('ru-RU')}
                </p>
                <button
                  onClick={() => deleteMutation.mutate(s.id)}
                  className="text-gray-400 hover:text-red-500"
                  title="Удалить сессию"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
