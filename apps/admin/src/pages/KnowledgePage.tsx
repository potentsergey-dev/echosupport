import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileIcon,
  GlobeIcon,
  TrashIcon,
  UploadCloudIcon,
  PlusIcon,
  RefreshCwIcon,
} from 'lucide-react';
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  listSources,
  addSource,
  deleteSource,
  triggerReindex,
  getLatestIndexingJob,
  updateAgent,
  getAgent,
} from '../lib/api';
import { useToastContext } from '../components/Layout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { formatBytes } from '../lib/utils';
import { ReindexProgress, type JobResult } from '../components/ReindexProgress';
import type { Document, KnowledgeSource, DocumentStatus, SourcePriority } from '../types';

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DocumentStatus }) {
  const map: Record<
    DocumentStatus,
    { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }
  > = {
    PENDING: { label: 'Ожидание', variant: 'default' },
    INDEXING: { label: 'Индексация', variant: 'info' },
    INDEXED: { label: 'Готово', variant: 'success' },
    FAILED: { label: 'Ошибка', variant: 'error' },
  };
  const { label, variant } = map[status] ?? { label: status, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}

// ── Reindex progress ──────────────────────────────────────────────────────────

// ── Files block ───────────────────────────────────────────────────────────────

function FilesBlock({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: docs = [] } = useQuery<Document[]>({
    queryKey: ['documents', agentId],
    queryFn: () => listDocuments(agentId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(agentId, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents', agentId] });
      addToast('Файл загружен');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(agentId, docId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents', agentId] });
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => uploadMutation.mutate(f));
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 transition-colors ${
          isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300'
        }`}
      >
        <UploadCloudIcon size={28} className="mb-2 text-gray-400" />
        <p className="text-sm text-gray-600">
          Перетащите файлы или <span className="text-indigo-600">выберите</span>
        </p>
        <p className="mt-1 text-xs text-gray-400">PDF, TXT, MD, DOCX, HTML</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.docx,.html"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Document list */}
      {docs.length > 0 && (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileIcon size={16} className="flex-shrink-0 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{doc.filename}</p>
                <p className="text-xs text-gray-400">
                  {formatBytes(doc.sizeBytes)}
                  {doc.chunksCount != null && ` · ${doc.chunksCount} чанков`}
                </p>
                {doc.errorMessage && (
                  <p className="mt-1 text-xs text-red-600">{doc.errorMessage}</p>
                )}
              </div>
              <StatusBadge status={doc.status} />
              <button
                onClick={() => deleteMutation.mutate(doc.id)}
                className="ml-2 text-gray-400 hover:text-red-500"
                title="Удалить"
              >
                <TrashIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {docs.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          Файлов пока нет. Загрузите документы с FAQ, условиями, ценами или инструкциями, затем
          запустите индексацию.
        </div>
      )}
    </div>
  );
}

// ── Sources block ─────────────────────────────────────────────────────────────

function SourcesBlock({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [url, setUrl] = useState('');
  const [maxDepth, setMaxDepth] = useState(1);

  const { data: sources = [] } = useQuery<KnowledgeSource[]>({
    queryKey: ['sources', agentId],
    queryFn: () => listSources(agentId),
  });

  const addMutation = useMutation({
    mutationFn: () => addSource(agentId, { url, maxDepth }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sources', agentId] });
      setUrl('');
      addToast('Источник добавлен');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (sourceId: string) => deleteSource(agentId, sourceId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sources', agentId] }),
    onError: (err) => addToast(err.message, 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.example.com"
            type="url"
          />
          <p className="mt-1 text-xs text-gray-400">
            Добавляйте публичные страницы, которые можно индексировать без входа.
          </p>
        </div>
        <div className="w-28">
          <Input
            type="number"
            min={0}
            max={5}
            value={maxDepth}
            onChange={(e) => setMaxDepth(parseInt(e.target.value, 10) || 1)}
            placeholder="Глубина"
            title="Глубина обхода"
          />
        </div>
        <Button
          loading={addMutation.isPending}
          disabled={!url.trim()}
          onClick={() => addMutation.mutate()}
        >
          <PlusIcon size={16} />
          Добавить
        </Button>
      </div>

      {sources.length > 0 && (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {sources.map((src) => (
            <div key={src.id} className="flex items-center gap-3 px-4 py-3">
              <GlobeIcon size={16} className="flex-shrink-0 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{src.url}</p>
                <p className="text-xs text-gray-400">
                  Глубина: {src.maxDepth}
                  {src.pagesIndexed != null && ` · ${src.pagesIndexed} страниц`}
                </p>
                {src.errorMessage && (
                  <p className="mt-1 text-xs text-red-600">{src.errorMessage}</p>
                )}
              </div>
              <StatusBadge status={src.status} />
              <button
                onClick={() => deleteMutation.mutate(src.id)}
                className="ml-2 text-gray-400 hover:text-red-500"
                title="Удалить"
              >
                <TrashIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {sources.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          URL-источников пока нет. Добавьте сайт или документацию, затем нажмите «Проиндексировать».
        </div>
      )}
    </div>
  );
}

// ── Source Priority Block ────────────────────────────────────────────────────

function SourcePriorityBlock({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const { data: agent } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => getAgent(agentId),
  });
  const [priority, setPriority] = useState<SourcePriority>(agent?.sourcePriority ?? 'MERGE');

  useEffect(() => {
    if (agent?.sourcePriority) setPriority(agent.sourcePriority);
  }, [agent?.sourcePriority]);

  const mutation = useMutation({
    mutationFn: () => updateAgent(agentId, { sourcePriority: priority }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent', agentId] });
      addToast('Приоритет источников сохранён');
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const options: { value: SourcePriority; label: string; description: string }[] = [
    {
      value: 'MERGE',
      label: 'Смешанный',
      description: 'Файлы и URL-источники с одинаковым приоритетом',
    },
    {
      value: 'FILES_FIRST',
      label: 'Файлы вперёд',
      description: 'Сначала чанки из файлов, затем из URL',
    },
    {
      value: 'URL_FIRST',
      label: 'URL вперёд',
      description: 'Сначала чанки из URL-источников, затем из файлов',
    },
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6">
      <h4 className="mb-4 text-sm font-semibold text-gray-900">Приоритет источников</h4>
      <div className="space-y-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
          >
            <input
              type="radio"
              name="source-priority"
              value={opt.value}
              checked={priority === opt.value}
              onChange={() => setPriority(opt.value)}
              className="mt-0.5 accent-indigo-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Сохранить
        </Button>
      </div>
    </section>
  );
}

// ── Knowledge Page ────────────────────────────────────────────────────────────

export function KnowledgePage({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { addToast } = useToastContext();
  const [jobId, setJobId] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const {
    data: latestJob,
    isPending: discoveringJob,
    isError: discoveryFailed,
  } = useQuery({
    queryKey: ['indexing-job', agentId],
    queryFn: () => getLatestIndexingJob(agentId),
    refetchInterval: 5_000,
  });
  const activeJobId =
    jobId ?? (latestJob && ['PENDING', 'RUNNING'].includes(latestJob.status) ? latestJob.id : null);

  useEffect(() => {
    if (latestJob && ['DONE', 'FAILED', 'CANCELLED'].includes(latestJob.status)) {
      void qc.invalidateQueries({ queryKey: ['documents', agentId] });
      void qc.invalidateQueries({ queryKey: ['sources', agentId] });
    }
  }, [latestJob?.id, latestJob?.status, agentId, qc]);

  useEffect(() => {
    setJobId(null);
    setReindexing(false);
  }, [agentId]);

  const reindexMutation = useMutation({
    mutationFn: () => triggerReindex(agentId),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setReindexing(true);
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  function handleReindexDone(result: JobResult) {
    setJobId(null);
    void qc.invalidateQueries({ queryKey: ['indexing-job', agentId] });
    setReindexing(false);
    void qc.invalidateQueries({ queryKey: ['documents', agentId] });
    void qc.invalidateQueries({ queryKey: ['sources', agentId] });
    if (result.status === 'FAILED') {
      addToast(result.errorMessage ?? 'Индексация завершилась с ошибкой', 'error');
      return;
    }
    addToast(result.status === 'CANCELLED' ? 'Индексация отменена' : 'Индексация завершена');
  }

  return (
    <div className="space-y-6">
      {/* Reindex button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">База знаний</h3>
          <p className="mt-1 text-sm text-gray-500">
            Источники используются в ответах после загрузки и успешной индексации.
          </p>
        </div>
        <Button
          loading={reindexMutation.isPending}
          disabled={reindexing || !!activeJobId || discoveringJob || discoveryFailed}
          onClick={() => reindexMutation.mutate()}
        >
          <RefreshCwIcon size={16} />
          Проиндексировать
        </Button>
      </div>

      {/* Progress bar */}
      {discoveryFailed && (
        <p role="status" className="text-sm text-gray-600">
          Не удалось получить статус индексации. Повторяем подключение…
        </p>
      )}
      {activeJobId && (
        <ReindexProgress key={activeJobId} jobId={activeJobId} onDone={handleReindexDone} />
      )}
      {!activeJobId && latestJob && ['DONE', 'FAILED', 'CANCELLED'].includes(latestJob.status) && (
        <p
          role="status"
          className={`text-sm ${latestJob.status === 'FAILED' ? 'text-red-600' : 'text-gray-600'}`}
        >
          {latestJob.status === 'DONE'
            ? 'Последняя индексация завершена.'
            : latestJob.status === 'CANCELLED'
              ? 'Последняя индексация отменена.'
              : `Индексация завершилась с ошибкой: ${latestJob.errorMessage ?? 'проверьте источники ниже'}`}
        </p>
      )}

      {/* Files */}
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="mb-4 text-sm font-semibold text-gray-900">Файлы</h4>
        <FilesBlock agentId={agentId} />
      </section>

      {/* URLs */}
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h4 className="mb-4 text-sm font-semibold text-gray-900">URL-источники</h4>
        <SourcesBlock agentId={agentId} />
      </section>

      {/* Source Priority */}
      <SourcePriorityBlock agentId={agentId} />
    </div>
  );
}
