import { useQuery } from '@tanstack/react-query';
import { ThumbsUpIcon, ThumbsDownIcon } from 'lucide-react';
import { getCsatReport, type CsatSummary } from '../lib/api';
import { listAgents } from '../lib/api';
import type { AgentListItem } from '../types';
import { useState } from 'react';

export function CsatPage() {
  const [agentId, setAgentId] = useState<string>('');

  const { data: agents = [] } = useQuery<AgentListItem[]>({
    queryKey: ['agents'],
    queryFn: listAgents,
  });

  const { data, isLoading } = useQuery<CsatSummary>({
    queryKey: ['csat', agentId],
    queryFn: () => getCsatReport(agentId || undefined),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">CSAT — Оценки качества</h1>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Все агенты</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Всего оценок" value={String(data.summary.total)} />
          <SummaryCard
            label="Положительных 👍"
            value={String(data.summary.positive)}
            color="text-green-600"
          />
          <SummaryCard
            label="Отрицательных 👎"
            value={String(data.summary.negative)}
            color="text-red-500"
          />
          <SummaryCard
            label="NPS балл"
            value={data.summary.score !== null ? `${data.summary.score}%` : '—'}
            color={
              data.summary.score !== null && data.summary.score >= 70
                ? 'text-green-600'
                : 'text-yellow-600'
            }
          />
        </div>
      )}

      {/* Ratings table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">История оценок</h2>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Дата</th>
                <th className="px-4 py-2 text-left">Агент</th>
                <th className="px-4 py-2 text-left">Посетитель</th>
                <th className="px-4 py-2 text-center">Оценка</th>
                <th className="px-4 py-2 text-left">Комментарий</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.ratings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Нет оценок
                  </td>
                </tr>
              )}
              {data?.ratings.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                    {new Date(r.startedAt).toLocaleDateString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2 text-gray-700">{r.agent.name}</td>
                  <td className="px-4 py-2 text-gray-600">{r.visitorName ?? '—'}</td>
                  <td className="px-4 py-2 text-center">
                    {r.csatRating > 0 ? (
                      <ThumbsUpIcon className="h-4 w-4 text-green-500 mx-auto" />
                    ) : (
                      <ThumbsDownIcon className="h-4 w-4 text-red-500 mx-auto" />
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">
                    {r.csatComment ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = 'text-gray-900',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
