import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PlusIcon,
  ChevronRightIcon,
  BotIcon,
  LogOutIcon,
  InboxIcon,
  CalendarIcon,
  UsersIcon,
  LayersIcon,
  StarIcon,
  LockIcon,
  UnlockIcon,
} from 'lucide-react';
import { listAgents, createAgent, listInboxSessions } from '../lib/api';
import { clearToken, clearRole, isAdminRole } from '../lib/auth';
import { clearWorkingMode, useWorkingMode } from '../lib/working-mode';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Textarea } from './ui/Textarea';
import type { AgentListItem, InboxSession } from '../types';
import { isLiteEdition } from '../lib/app-edition';

function NewAgentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');

  const mutation = useMutation({
    mutationFn: () => createAgent({ name, systemPrompt }),
    onSuccess: (agent) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      onClose();
      navigate(`/agents/${agent.id}`);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Новый агент</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="agent-name">Название</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support Bot"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="agent-prompt">Системный промпт</Label>
            <Textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>
          {mutation.error && <p className="text-sm text-red-600">{mutation.error.message}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!name.trim()}
            onClick={() => mutation.mutate()}
          >
            Создать
          </Button>
        </div>
      </div>
    </div>
  );
}

function navClass(active: boolean) {
  return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors mb-1 ${
    active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-100'
  }`;
}

export function Sidebar({ activeAgentId }: { activeAgentId?: string | undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [showNewModal, setShowNewModal] = useState(false);
  const isAdmin = isAdminRole();
  const [workingMode, setWorkingMode] = useWorkingMode();
  const canUseWorkingMode = isAdmin && !isLiteEdition;
  const showConfiguration = isAdmin && (isLiteEdition || !workingMode);

  const { data: agents = [] } = useQuery<AgentListItem[]>({
    queryKey: ['agents'],
    queryFn: listAgents,
    enabled: isAdmin,
  });

  const { data: openSessions = [] } = useQuery<InboxSession[]>({
    queryKey: ['sidebar-inbox-summary'],
    queryFn: () => listInboxSessions({ status: 'ALL_OPEN' }),
    enabled: !isLiteEdition,
    refetchInterval: 15000,
  });

  const unreadInboxCount = openSessions.reduce(
    (total, session) => total + session.unreadByOperator,
    0,
  );
  const openInboxCount = openSessions.length;

  function handleLogout() {
    clearToken();
    clearRole();
    clearWorkingMode();
    qc.clear();
    navigate('/login');
  }

  return (
    <>
      <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4">
          <BotIcon size={20} className="text-indigo-600" />
          <span className="font-semibold text-gray-900">EchoSupport</span>
        </div>

        {showConfiguration && (
          <div className="p-3">
            <Button className="w-full" size="sm" onClick={() => setShowNewModal(true)}>
              <PlusIcon size={16} />
              Новый агент
            </Button>
          </div>
        )}

        {canUseWorkingMode && (
          <div className="px-3 pb-3 pt-3">
            <button
              type="button"
              onClick={() => setWorkingMode(!workingMode)}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                workingMode
                  ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
              title={workingMode ? 'Выключить рабочий режим' : 'Включить рабочий режим'}
            >
              {workingMode ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
              <span className="flex-1">{workingMode ? 'Рабочий режим' : 'Полный режим'}</span>
            </button>
            {workingMode && (
              <p className="mt-2 px-1 text-xs leading-5 text-amber-700">
                Настройки скрыты. Доступны чаты, записи и CSAT.
              </p>
            )}
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {!isLiteEdition && (
            <>
              <Link to="/inbox" className={navClass(location.pathname === '/inbox')}>
                <InboxIcon size={16} className="shrink-0" />
                <span className="flex-1">Входящие</span>
                {unreadInboxCount > 0 ? (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white">
                    {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
                  </span>
                ) : openInboxCount > 0 ? (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold leading-none text-gray-700">
                    {openInboxCount > 99 ? '99+' : openInboxCount}
                  </span>
                ) : null}
              </Link>
              <Link
                to="/appointments"
                className={navClass(location.pathname.startsWith('/appointments'))}
              >
                <CalendarIcon size={16} className="shrink-0" />
                <span className="flex-1">Записи</span>
              </Link>
              {!workingMode && (
                <>
                  <Link
                    to="/specialists"
                    className={navClass(location.pathname.startsWith('/specialists'))}
                  >
                    <UsersIcon size={16} className="shrink-0" />
                    <span className="flex-1">Специалисты</span>
                  </Link>
                  <Link
                    to="/services"
                    className={navClass(location.pathname.startsWith('/services'))}
                  >
                    <LayersIcon size={16} className="shrink-0" />
                    <span className="flex-1">Услуги</span>
                  </Link>
                </>
              )}
              <Link to="/csat" className={navClass(location.pathname.startsWith('/csat'))}>
                <StarIcon size={16} className="shrink-0" />
                <span className="flex-1">CSAT</span>
              </Link>
              <div className="my-1 border-t border-gray-100" />
            </>
          )}

          {showConfiguration &&
            agents.map((agent) => (
              <Link
                key={agent.id}
                to={`/agents/${agent.id}`}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  agent.id === activeAgentId
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {agent.avatarUrl ? (
                  <img
                    src={agent.avatarUrl}
                    alt={agent.name}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
                    {agent.name[0]?.toUpperCase()}
                  </div>
                )}
                <span className="flex-1 truncate">{agent.name}</span>
                {agent.id === activeAgentId && (
                  <ChevronRightIcon size={14} className="text-indigo-400" />
                )}
              </Link>
            ))}
          {showConfiguration && agents.length === 0 && (
            <p className="px-3 py-4 text-xs text-gray-400">Нет агентов. Создайте первого!</p>
          )}
        </nav>

        <div className="border-t border-gray-200 p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOutIcon size={16} />
            Выйти
          </button>
        </div>
      </aside>

      {showNewModal && <NewAgentModal onClose={() => setShowNewModal(false)} />}
    </>
  );
}
