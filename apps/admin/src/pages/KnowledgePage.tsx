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
  updateAgent,
  getAgent,
} from '../lib/api';
import { useToastContext } from '../components/Layout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { formatBytes } from '../lib/utils';
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

function ReindexProgress({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('RUNNING');
  const [errorMsg, setErrorMsg] = useState('');

  // Poll via SSE
  useEffect(() => {
    const apiBase = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
    const token = localStorage.getItem('es_admin_token') ?? '';
    const url = `${apiBase}/api/v1/admin/jobs/${jobId}/stream`;
    const es = new EventSource(url + `?token=${encodeURIComponent(token)}`);

    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as {
        progress: number;
        status: string;
      };
      setProgress(data.progress);
      setStatus(data.status);
    });

    es.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as {
        status: string;
        errorMessage?: string;
      };
      setStatus(data.status);
      if (data.errorMessage) setErrorMsg(data.errorMessage);
      es.close();
      onDone();
    });

    es.addEventListener('error', () => {
      es.close();
      setErrorMsg('Ошибка подключения к SSE');
    });

    return () => es.close();
  }, [jobId, onDone]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
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
      {errorMsg && <p className="mt-2 text-sm text-red-600">{errorMsg}</p>}
      {status === 'DONE' && (
        <p className="mt-2 text-sm font-medium text-green-600">Индексация завершена ✓</p>
      )}
    </div>
  );
}

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

  const reindexMutation = useMutation({
    mutationFn: () => triggerReindex(agentId),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setReindexing(true);
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  function handleReindexDone() {
    setReindexing(false);
    void qc.invalidateQueries({ queryKey: ['documents', agentId] });
    void qc.invalidateQueries({ queryKey: ['sources', agentId] });
    addToast('Индексация завершена');
  }

  return (
    <div className="space-y-6">
      {/* Reindex button */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">База знаний</h3>
        <Button
          loading={reindexMutation.isPending}
          disabled={reindexing}
          onClick={() => reindexMutation.mutate()}
        >
          <RefreshCwIcon size={16} />
          Проиндексировать
        </Button>
      </div>

      {/* Progress bar */}
      {reindexing && jobId && <ReindexProgress jobId={jobId} onDone={handleReindexDone} />}

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
