import { useQuery } from '@tanstack/react-query';
import { AlertTriangleIcon, CheckCircleIcon, RefreshCwIcon, XCircleIcon } from 'lucide-react';
import { getAgentConfigCheck } from '../lib/api';
import { Button } from '../components/ui/Button';
import type { ConfigCheckItem, ConfigCheckStatus } from '../types';

const STATUS_META: Record<
  ConfigCheckStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  ok: {
    label: 'Готово',
    className: 'border-green-200 bg-green-50 text-green-700',
    icon: <CheckCircleIcon size={18} />,
  },
  warning: {
    label: 'Есть предупреждения',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: <AlertTriangleIcon size={18} />,
  },
  error: {
    label: 'Нужно исправить',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: <XCircleIcon size={18} />,
  },
};

function CheckItemRow({ item }: { item: ConfigCheckItem }) {
  const meta = STATUS_META[item.status];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-full border p-1 ${meta.className}`}>{meta.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{item.label}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">{item.message}</p>
          {item.action && <p className="mt-2 text-xs text-gray-500">Что сделать: {item.action}</p>}
        </div>
      </div>
    </div>
  );
}

export function ConfigCheckPage({ agentId }: { agentId: string }) {
  const query = useQuery({
    queryKey: ['agent-config-check', agentId],
    queryFn: () => getAgentConfigCheck(agentId),
  });

  const report = query.data;
  const meta = report ? STATUS_META[report.status] : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Проверка конфигурации</h2>
            <p className="mt-1 text-sm text-gray-500">
              Проверяет зависимости, ключи, базу знаний, домены и готовность виджета.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            loading={query.isFetching}
          >
            <RefreshCwIcon size={16} /> Проверить снова
          </Button>
        </div>

        {query.isLoading && <p className="mt-5 text-sm text-gray-400">Проверяем настройки...</p>}
        {query.error && (
          <p className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {query.error.message}
          </p>
        )}
        {report && meta && (
          <div
            className={`mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${meta.className}`}
          >
            {meta.icon}
            {meta.label}
          </div>
        )}
        {report && (
          <p className="mt-3 text-xs text-gray-400">
            Последняя проверка: {new Date(report.checkedAt).toLocaleString('ru-RU')}
          </p>
        )}
      </div>

      {report && (
        <div className="grid gap-3">
          {report.items.map((item) => (
            <CheckItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
