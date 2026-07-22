import { useState, useEffect } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserIcon,
  KeyIcon,
  BookOpenIcon,
  CodeIcon,
  MessageSquareIcon,
  UploadIcon,
  EyeIcon,
  EyeOffIcon,
  ClockIcon,
  ShieldIcon,
  ActivityIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ArrowRightIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  getAgent,
  updateAgent,
  uploadAvatar,
  saveSecrets,
  getSecrets,
  getBusinessHours,
  saveBusinessHours,
  getAgentConfigCheck,
  deleteAgent,
} from '../lib/api';
import { Layout, useToastContext } from '../components/Layout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Textarea } from '../components/ui/Textarea';
import type { Agent, BusinessHours, ConfigCheckItem, ScheduleEntry } from '../types';
import { KnowledgePage } from './KnowledgePage';
import { EmbedPage } from './EmbedPage';
import { ConfigCheckPage } from './ConfigCheckPage';
import { SessionsPage } from './SessionsPage';
import { ProactiveMessageFields } from '../components/ProactiveMessageFields';
import { isLiteEdition } from '../lib/app-edition';

// ── Tab definitions ──────────────────────────────────────────────────────────

type Tab =
  | 'profile'
  | 'secrets'
  | 'knowledge'
  | 'embed'
  | 'config-check'
  | 'sessions'
  | 'business-hours'
  | 'anti-abuse';

const TABS: { id: Tab; label: string; icon: React.ReactNode; lite?: boolean }[] = [
  { id: 'profile', label: 'Профиль', icon: <UserIcon size={16} />, lite: true },
  { id: 'secrets', label: 'API-ключи', icon: <KeyIcon size={16} />, lite: true },
  { id: 'knowledge', label: 'База знаний', icon: <BookOpenIcon size={16} />, lite: true },
  { id: 'embed', label: 'Embed', icon: <CodeIcon size={16} />, lite: true },
  { id: 'config-check', label: 'Проверка', icon: <ActivityIcon size={16} />, lite: true },
  { id: 'sessions', label: 'Сессии', icon: <MessageSquareIcon size={16} /> },
  { id: 'business-hours', label: 'Часы работы', icon: <ClockIcon size={16} /> },
  { id: 'anti-abuse', label: 'Лимиты', icon: <ShieldIcon size={16} /> },
];

const VISIBLE_TABS = isLiteEdition ? TABS.filter((tab) => tab.lite) : TABS;

// ── TagsInput ─────────────────────────────────────────────────────────────────

function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');

  function addTag() {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput('');
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-white px-3 py-2">
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="hover:text-indigo-900"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder={value.length === 0 ? 'https://example.com (Enter)' : ''}
          className="flex-1 min-w-32 border-none outline-none text-sm"
        />
      </div>
    </div>
  );
}

// ── Profile Block ─────────────────────────────────────────────────────────────

function ProfileBlock({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [form, setForm] = useState({
    name: agent.name,
    role: agent.role ?? '',
    greetingMessage: agent.greetingMessage ?? '',
    proactiveMessageDelay: agent.proactiveMessageDelay,
    proactiveMessageText: agent.proactiveMessageText ?? '',
    systemPrompt: agent.systemPrompt,
    llmModel: agent.llmModel,
    language: agent.language,
    sessionTtlMinutes: agent.sessionTtlMinutes,
    allowedOrigins: agent.allowedOrigins,
    sttProvider: agent.sttProvider,
  });

  // Avatar state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(agent.avatarUrl);
  const [isDragging, setIsDragging] = useState(false);

  const mutation = useMutation({
    mutationFn: () => updateAgent(agent.id, { ...form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent', agent.id] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
      addToast('Настройки сохранены');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const avatarMutation = useMutation({
    mutationFn: () => uploadAvatar(agent.id, avatarFile!),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['agent', agent.id] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
      setAvatarFile(null);
      setAvatarPreview(updated.avatarUrl);
      addToast('Аватар загружен');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  function handleAvatarFile(file: File) {
    setAvatarFile(file);
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
  }

  return (
    <div className="space-y-8">
      {/* Avatar */}
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Аватар</h3>
        <div className="flex items-start gap-6">
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border-2 border-gray-200 bg-indigo-50">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-indigo-400">
                {agent.name[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleAvatarFile(file);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                isDragging
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-gray-300 hover:border-indigo-300'
              }`}
              onClick={() => document.getElementById('avatar-input')?.click()}
            >
              <UploadIcon size={20} className="mb-2 text-gray-400" />
              <p className="text-sm text-gray-600">
                Перетащите изображение или <span className="text-indigo-600">выберите файл</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">JPG, PNG, WebP, GIF · макс 5 MB</p>
            </div>
            <input
              id="avatar-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarFile(file);
              }}
            />
            {avatarFile && (
              <Button
                size="sm"
                className="mt-3"
                loading={avatarMutation.isPending}
                onClick={() => avatarMutation.mutate()}
              >
                Загрузить аватар
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Profile form */}
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Основные настройки</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Название агента</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="role">Роль / должность</Label>
            <Input
              id="role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="Support agent"
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="greeting">Приветственное сообщение</Label>
            <Input
              id="greeting"
              value={form.greetingMessage}
              onChange={(e) => setForm((f) => ({ ...f, greetingMessage: e.target.value }))}
              placeholder="Привет! Чем могу помочь?"
              className="mt-1"
            />
          </div>
          <ProactiveMessageFields
            delay={form.proactiveMessageDelay}
            text={form.proactiveMessageText}
            onDelayChange={(value) =>
              setForm((current) => ({ ...current, proactiveMessageDelay: value }))
            }
            onTextChange={(value) =>
              setForm((current) => ({ ...current, proactiveMessageText: value }))
            }
          />
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="system-prompt">Системный промпт</Label>
              <span className="text-xs text-gray-400">{form.systemPrompt.length} символов</span>
            </div>
            <Textarea
              id="system-prompt"
              value={form.systemPrompt}
              onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
              rows={5}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="llm-model">LLM модель</Label>
            <Input
              id="llm-model"
              value={form.llmModel}
              onChange={(e) => setForm((f) => ({ ...f, llmModel: e.target.value }))}
              placeholder="openai/gpt-4o-mini"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-gray-400">
              Модель должна быть доступна у выбранного OpenAI-compatible провайдера: OpenRouter,
              Ollama, vLLM или другой endpoint.
            </p>
          </div>
          <div>
            <Label htmlFor="language">Язык интерфейса</Label>
            <select
              id="language"
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="auto">Auto</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Auto использует язык браузера посетителя. Если язык не поддерживается, будет English.
              AI отвечает на языке вопроса пользователя.
            </p>
          </div>
          <div>
            <Label htmlFor="ttl">TTL сессии (минуты)</Label>
            <Input
              id="ttl"
              type="number"
              min={5}
              max={10080}
              value={form.sessionTtlMinutes}
              onChange={(e) =>
                setForm((f) => ({ ...f, sessionTtlMinutes: parseInt(e.target.value, 10) || 120 }))
              }
              className="mt-1"
            />
          </div>
          {!isLiteEdition && (
            <div>
              <Label htmlFor="stt-provider">STT провайдер</Label>
              <select
                id="stt-provider"
                value={form.sttProvider}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    sttProvider: e.target.value as typeof form.sttProvider,
                  }))
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="DEEPGRAM">Deepgram</option>
                <option value="WHISPER">Whisper (OpenAI)</option>
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <Label>Разрешённые источники (CORS)</Label>
            <div className="mt-1">
              <TagsInput
                value={form.allowedOrigins}
                onChange={(tags) => setForm((f) => ({ ...f, allowedOrigins: tags }))}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Укажите origin сайта со схемой и портом: https://example.com. Путь страницы не нужен.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Сохранить настройки
          </Button>
        </div>
      </section>
    </div>
  );
}

// ── Secrets Block ─────────────────────────────────────────────────────────────

function SecretsBlock({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [fields, setFields] = useState({
    openrouterKey: '',
    openrouterEmbeddingKey: '',
    openaiKey: '',
    openaiEmbeddingKey: '',
    deepgramKey: '',
  });
  const [visible, setVisible] = useState({
    openrouterKey: false,
    openrouterEmbeddingKey: false,
    openaiKey: false,
    openaiEmbeddingKey: false,
    deepgramKey: false,
  });

  const { data: maskedData } = useQuery({
    queryKey: ['secrets', agentId],
    queryFn: () => getSecrets(agentId),
  });
  const masked = maskedData ?? {
    openrouterKey: null,
    openrouterEmbeddingKey: null,
    openaiKey: null,
    openaiEmbeddingKey: null,
    deepgramKey: null,
  };

  const mutation = useMutation({
    mutationFn: () => {
      const payload = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v.trim() !== ''),
      ) as {
        openrouterKey?: string;
        openrouterEmbeddingKey?: string;
        openaiKey?: string;
        openaiEmbeddingKey?: string;
        deepgramKey?: string;
      };
      return saveSecrets(agentId, payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['secrets', agentId] });
      setFields({
        openrouterKey: '',
        openrouterEmbeddingKey: '',
        openaiKey: '',
        openaiEmbeddingKey: '',
        deepgramKey: '',
      });
      addToast('API-ключи сохранены');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const secretFields: {
    key: keyof typeof fields;
    label: string;
    placeholder: string;
    hint?: string;
    lite?: boolean;
  }[] = [
    {
      key: 'openrouterKey',
      label: 'OpenRouter / compatible API Key (чат)',
      placeholder: 'sk-or-...',
      hint: 'Используется для генерации ответов через OpenRouter или compatible endpoint. Для Ollama можно указать служебное значение, например ollama.',
      lite: true,
    },
    {
      key: 'openrouterEmbeddingKey',
      label: 'OpenRouter / compatible API Key (embeddings)',
      placeholder: 'sk-or-...',
      hint: 'Отдельный ключ для векторизации. Для локального compatible endpoint должен поддерживаться /v1/embeddings.',
      lite: true,
    },
    {
      key: 'openaiKey',
      label: 'OpenAI API Key',
      placeholder: 'sk-...',
      hint: 'Используется для прямых запросов к OpenAI (эмбеддинги и/или Whisper STT)',
    },
    {
      key: 'openaiEmbeddingKey',
      label: 'OpenAI API Key (только embeddings)',
      placeholder: 'sk-...',
      hint: 'Отдельный ключ для эмбеддингов через OpenAI напрямую',
    },
    { key: 'deepgramKey', label: 'Deepgram API Key', placeholder: 'dg_...' },
  ];

  const visibleSecretFields = isLiteEdition
    ? secretFields.filter((field) => field.lite)
    : secretFields;
  const visibleSecretKeys = new Set(visibleSecretFields.map((field) => field.key));
  const hasAnyKey = Object.entries(fields).some(
    ([key, value]) => visibleSecretKeys.has(key as keyof typeof fields) && value.trim() !== '',
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-1 text-base font-semibold text-gray-900">API-ключи</h3>
      <p className="mb-5 text-sm text-gray-500">
        Ключи шифруются перед сохранением. Оставьте поле пустым, чтобы не менять текущий ключ.{' '}
        {isLiteEdition
          ? 'В Lite-режиме обычно достаточно ключа для чата и ключа для embeddings. Это может быть OpenRouter или OpenAI-compatible endpoint.'
          : 'Для первого AI-ответа нужен ключ для чата или глобальный compatible ключ в .env.'}
      </p>
      <div className="space-y-4">
        {visibleSecretFields.map(({ key, label, placeholder, hint }) => (
          <div key={key}>
            <Label htmlFor={key}>{label}</Label>
            {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
            {masked[key] && !fields[key] && (
              <p className="mt-0.5 mb-1 text-xs text-gray-400">
                Текущий: <span className="font-mono">{masked[key]}</span>
              </p>
            )}
            <div className="relative mt-1">
              <Input
                id={key}
                type={visible[key] ? 'text' : 'password'}
                value={fields[key]}
                onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {visible[key] ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button
          loading={mutation.isPending}
          disabled={!hasAnyKey}
          onClick={() => mutation.mutate()}
        >
          Сохранить ключи
        </Button>
      </div>
    </section>
  );
}

// ── Delete agent block ────────────────────────────────────────────────────────

function DeleteAgentBlock({ agent }: { agent: Agent }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [confirmName, setConfirmName] = useState('');
  const canDelete = confirmName.trim() === agent.name;

  const mutation = useMutation({
    mutationFn: () => deleteAgent(agent.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      qc.removeQueries({ queryKey: ['agent', agent.id] });
      addToast('Агент удален');
      navigate('/agents');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  return (
    <section className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-red-800">
            <Trash2Icon size={18} />
            <h3 className="text-base font-semibold">Удаление агента</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-red-700">
            Будут удалены настройки агента, документы, источники базы знаний, история сессий и
            сообщения этого агента. Действие нельзя отменить.
          </p>
          <Label htmlFor="delete-agent-confirm" className="mt-4 text-red-900">
            Для подтверждения введите название агента: {agent.name}
          </Label>
          <Input
            id="delete-agent-confirm"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="mt-1 border-red-200 bg-white focus:border-red-500 focus:ring-red-500"
            placeholder={agent.name}
          />
        </div>
        <Button
          variant="danger"
          className="shrink-0"
          disabled={!canDelete}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Удалить агента
        </Button>
      </div>
    </section>
  );
}
// ── First-run checklist ───────────────────────────────────────────────────────

type QuickStartStep = {
  id: string;
  label: string;
  description: string;
  status: 'ok' | 'warning' | 'error';
  tab: Tab;
};

function pickCheck(items: ConfigCheckItem[] | undefined, id: string): ConfigCheckItem | undefined {
  return items?.find((item) => item.id === id);
}

function worstStatus(items: Array<ConfigCheckItem | undefined>): 'ok' | 'warning' | 'error' {
  if (items.some((item) => item?.status === 'error')) return 'error';
  if (items.some((item) => item?.status === 'warning' || !item)) return 'warning';
  return 'ok';
}

function QuickStartPanel({ agent, onOpenTab }: { agent: Agent; onOpenTab: (tab: Tab) => void }) {
  const query = useQuery({
    queryKey: ['agent-config-check', agent.id],
    queryFn: () => getAgentConfigCheck(agent.id),
  });
  const items = query.data?.items;
  const chatKey = pickCheck(items, 'chat-key');
  const embeddingKey = pickCheck(items, 'embedding-key');
  const knowledge = pickCheck(items, 'knowledge');
  const origins = pickCheck(items, 'origins');
  const embed = pickCheck(items, 'embed');
  const profileStatus =
    agent.isActive && agent.name.trim() && agent.systemPrompt.trim() ? 'ok' : 'warning';

  const steps: QuickStartStep[] = [
    {
      id: 'profile',
      label: 'Профиль агента',
      description:
        profileStatus === 'ok'
          ? 'Название, промпт и активность агента заполнены.'
          : 'Проверьте название, системный промпт и что агент включен.',
      status: profileStatus,
      tab: 'profile',
    },
    {
      id: 'keys',
      label: 'AI-ключи',
      description:
        chatKey?.status === 'ok' && embeddingKey?.status === 'ok'
          ? 'Ключи для ответов и индексации настроены.'
          : 'Добавьте ключ для AI-ответов и embeddings или compatible endpoint.',
      status: worstStatus([chatKey, embeddingKey]),
      tab: 'secrets',
    },
    {
      id: 'knowledge',
      label: 'База знаний',
      description: knowledge?.message ?? 'Добавьте документы или сайт и запустите индексацию.',
      status: knowledge?.status ?? 'warning',
      tab: 'knowledge',
    },
    {
      id: 'origins',
      label: 'Домены сайта',
      description: origins?.message ?? 'Для production укажите сайты, где разрешен виджет.',
      status: origins?.status ?? 'warning',
      tab: 'profile',
    },
    {
      id: 'embed',
      label: 'Установка виджета',
      description:
        embed?.status === 'ok'
          ? 'Публичный ключ готов, embed-код можно установить.'
          : 'Проверьте embed-код и публичный ключ агента.',
      status: embed?.status ?? 'warning',
      tab: 'embed',
    },
  ];

  const completed = steps.filter((step) => step.status === 'ok').length;
  const hasBlockingIssues = steps.some((step) => step.status === 'error');
  const statusLabel = hasBlockingIssues
    ? 'Есть обязательные исправления'
    : completed === steps.length
      ? 'Агент готов к проверке на сайте'
      : 'Осталось несколько шагов';

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Быстрый старт</h2>
          <p className="mt-1 text-sm text-gray-500">
            Минимальные шаги, чтобы агент отвечал по документам и виджет можно было установить на
            сайт.
          </p>
        </div>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
          {completed}/{steps.length} готово
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {steps.map((step) => {
          const iconClass =
            step.status === 'ok'
              ? 'border-green-200 bg-green-50 text-green-700'
              : step.status === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-700';
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onOpenTab(step.tab)}
              className="flex min-h-24 items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className={`mt-0.5 rounded-full border p-1 ${iconClass}`}>
                {step.status === 'ok' ? (
                  <CheckCircle2Icon size={16} />
                ) : (
                  <AlertTriangleIcon size={16} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-900">{step.label}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-500">
                  {step.description}
                </span>
              </span>
              <ArrowRightIcon size={16} className="mt-1 flex-shrink-0 text-gray-400" />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700">{statusLabel}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpenTab('config-check')}
          loading={query.isFetching}
        >
          Открыть полную проверку
        </Button>
      </div>
    </section>
  );
}
// ── Agent Settings Page ───────────────────────────────────────────────────────

export function AgentSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const visibleTabs = VISIBLE_TABS;

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('profile');
    }
  }, [activeTab, visibleTabs]);

  const {
    data: agent,
    isLoading,
    error,
  } = useQuery<Agent>({
    queryKey: ['agent', id],
    queryFn: () => getAgent(id!),
    enabled: !!id,
  });

  if (!id) return <Navigate to="/agents" replace />;

  return (
    <Layout activeAgentId={id}>
      <div className="mx-auto max-w-4xl px-6 py-6">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 p-6 text-red-700">Ошибка: {error.message}</div>
        )}

        {agent && (
          <>
            {/* Header */}
            <div className="mb-6 flex items-center gap-4">
              {agent.avatarUrl ? (
                <img
                  src={agent.avatarUrl}
                  alt={agent.name}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-600">
                  {agent.name[0]?.toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-xl font-bold text-gray-900">{agent.name}</h1>
                <p className="text-sm text-gray-500 font-mono">{agent.publicKey}</p>
              </div>
            </div>

            <QuickStartPanel agent={agent} onOpenTab={setActiveTab} />

            {/* Tabs */}
            <div className="mb-6 flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'profile' && (
              <>
                <ProfileBlock agent={agent} />
                <DeleteAgentBlock agent={agent} />
              </>
            )}
            {activeTab === 'secrets' && <SecretsBlock agentId={agent.id} />}
            {activeTab === 'knowledge' && <KnowledgePage agentId={agent.id} />}
            {activeTab === 'embed' && <EmbedPage agentId={agent.id} />}
            {activeTab === 'config-check' && <ConfigCheckPage agentId={agent.id} />}
            {!isLiteEdition && activeTab === 'sessions' && <SessionsPage agentId={agent.id} />}
            {!isLiteEdition && activeTab === 'business-hours' && (
              <BusinessHoursBlock agentId={agent.id} />
            )}
            {!isLiteEdition && activeTab === 'anti-abuse' && <AntiAbuseBlock agent={agent} />}
          </>
        )}
      </div>
    </Layout>
  );
}

// ── Business Hours Block ──────────────────────────────────────────────────────

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function BusinessHoursBlock({ agentId }: { agentId: string }) {
  const { addToast } = useToastContext();
  const qc = useQueryClient();

  const { data: bh, isLoading } = useQuery<BusinessHours | null>({
    queryKey: ['business-hours', agentId],
    queryFn: () => getBusinessHours(agentId),
  });

  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Europe/Moscow');
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([
    { dayOfWeek: 1, from: '09:00', to: '18:00' },
    { dayOfWeek: 2, from: '09:00', to: '18:00' },
    { dayOfWeek: 3, from: '09:00', to: '18:00' },
    { dayOfWeek: 4, from: '09:00', to: '18:00' },
    { dayOfWeek: 5, from: '09:00', to: '18:00' },
  ]);
  const [outOfHoursMessage, setOutOfHoursMessage] = useState('');

  useEffect(() => {
    if (bh) {
      setEnabled(bh.enabled);
      setTimezone(bh.timezone);
      setSchedule(bh.schedule);
      setOutOfHoursMessage(bh.outOfHoursMessage ?? '');
    }
  }, [bh]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBusinessHours(agentId, {
        enabled,
        timezone,
        schedule,
        holidays: [],
        outOfHoursMessage: outOfHoursMessage || null,
      }),
    onSuccess: () => {
      addToast('Часы работы сохранены', 'success');
      void qc.invalidateQueries({ queryKey: ['business-hours', agentId] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  function toggleDay(dayOfWeek: number) {
    const existing = schedule.find((e) => e.dayOfWeek === dayOfWeek);
    if (existing) {
      setSchedule(schedule.filter((e) => e.dayOfWeek !== dayOfWeek));
    } else {
      setSchedule(
        [...schedule, { dayOfWeek, from: '09:00', to: '18:00' }].sort(
          (a, b) => a.dayOfWeek - b.dayOfWeek,
        ),
      );
    }
  }

  function updateEntry(dayOfWeek: number, field: 'from' | 'to', value: string) {
    setSchedule(schedule.map((e) => (e.dayOfWeek === dayOfWeek ? { ...e, [field]: value } : e)));
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white px-6 py-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Часы работы операторов</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Если включено, агент учитывает рабочее время при эскалации к оператору.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          id="bh-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="bh-enabled" className="text-sm font-medium text-gray-700">
          Включить ограничение по часам работы
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <Label>Часовой пояс</Label>
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Europe/Moscow"
              className="mt-1 max-w-xs"
            />
            <p className="mt-1 text-xs text-gray-400">
              Например: Europe/Moscow, America/New_York, UTC
            </p>
          </div>

          <div>
            <Label>Расписание</Label>
            <div className="mt-2 space-y-2">
              {DAYS.map((dayLabel, idx) => {
                const entry = schedule.find((e) => e.dayOfWeek === idx);
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <button
                      onClick={() => toggleDay(idx)}
                      className={`w-10 rounded-md py-1 text-xs font-medium transition-colors ${
                        entry ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {dayLabel}
                    </button>
                    {entry ? (
                      <>
                        <input
                          type="time"
                          value={entry.from}
                          onChange={(e) => updateEntry(idx, 'from', e.target.value)}
                          className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                        <span className="text-gray-400">—</span>
                        <input
                          type="time"
                          value={entry.to}
                          onChange={(e) => updateEntry(idx, 'to', e.target.value)}
                          className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">Выходной</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="bh-msg">Сообщение вне рабочего времени</Label>
            <Textarea
              id="bh-msg"
              value={outOfHoursMessage}
              onChange={(e) => setOutOfHoursMessage(e.target.value)}
              rows={2}
              placeholder="Операторы работают Пн–Пт с 09:00 до 18:00 по МСК."
              className="mt-1"
            />
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

// ── Anti-abuse Block ──────────────────────────────────────────────────────────

function AntiAbuseBlock({ agent }: { agent: Agent }) {
  const { addToast } = useToastContext();
  const qc = useQueryClient();

  const [maxMessages, setMaxMessages] = useState(agent.maxMessagesPerHourPerVisitor);
  const [maxSessions, setMaxSessions] = useState(agent.maxSessionsPerDayPerVisitor);
  const [maxLength, setMaxLength] = useState(agent.maxMessageLength);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateAgent(agent.id, {
        maxMessagesPerHourPerVisitor: maxMessages,
        maxSessionsPerDayPerVisitor: maxSessions,
        maxMessageLength: maxLength,
      }),
    onSuccess: () => {
      addToast('Лимиты сохранены', 'success');
      void qc.invalidateQueries({ queryKey: ['agent', agent.id] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white px-6 py-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Ограничения (Anti-abuse)</h3>
        <p className="mt-0.5 text-sm text-gray-500">Лимиты защищают от злоупотреблений и спама.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="max-msg">Сообщений в час / посетитель</Label>
          <Input
            id="max-msg"
            type="number"
            min={1}
            max={1000}
            value={maxMessages}
            onChange={(e) => setMaxMessages(Number(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="max-sess">Сессий в день / посетитель</Label>
          <Input
            id="max-sess"
            type="number"
            min={1}
            max={100}
            value={maxSessions}
            onChange={(e) => setMaxSessions(Number(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="max-len">Макс. длина сообщения (символов)</Label>
          <Input
            id="max-len"
            type="number"
            min={100}
            max={10000}
            value={maxLength}
            onChange={(e) => setMaxLength(Number(e.target.value))}
            className="mt-1"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
