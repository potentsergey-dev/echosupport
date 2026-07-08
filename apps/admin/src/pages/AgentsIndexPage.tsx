import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { listAgents } from '../lib/api';
import { Layout } from '../components/Layout';
import type { AgentListItem } from '../types';

export function AgentsIndexPage() {
  const navigate = useNavigate();
  const { data: agents = [], isLoading } = useQuery<AgentListItem[]>({
    queryKey: ['agents'],
    queryFn: listAgents,
  });

  // Redirect to first agent when available
  useEffect(() => {
    if (!isLoading && agents.length > 0 && agents[0]) {
      navigate(`/agents/${agents[0].id}`, { replace: true });
    }
  }, [agents, isLoading, navigate]);

  return (
    <Layout>
      <div className="flex h-full items-center justify-center">
        {isLoading ? (
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        ) : agents.length === 0 ? (
          <div className="text-center">
            <p className="text-gray-500">Нет агентов.</p>
            <p className="mt-1 text-sm text-gray-400">
              Нажмите «Новый агент» в боковом меню, затем заполните профиль, API-ключи, базу знаний
              и Embed-код.
            </p>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
