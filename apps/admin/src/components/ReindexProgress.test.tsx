import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ getJob: vi.fn(), getLatestIndexingJob: vi.fn() }));
vi.mock('../lib/api', () => ({
  ...api,
  getJobStreamUrl: (id: string) => `/api/v1/admin/jobs/${id}/stream`,
  listDocuments: vi.fn().mockResolvedValue([]),
  listSources: vi.fn().mockResolvedValue([]),
  getAgent: vi.fn().mockResolvedValue({ sourcePriority: 'MERGE' }),
  triggerReindex: vi.fn(),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
  addSource: vi.fn(),
  deleteSource: vi.fn(),
  updateAgent: vi.fn(),
}));
vi.mock('./Layout', () => ({ useToastContext: () => ({ addToast: vi.fn() }) }));
import { ReindexProgress } from './ReindexProgress';
import { KnowledgePage } from '../pages/KnowledgePage';

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  constructor(public url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  api.getJob.mockReset().mockResolvedValue({ id: 'job', status: 'RUNNING', progress: 40 });
  api.getLatestIndexingJob.mockReset().mockResolvedValue(null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('indexing observation', () => {
  it('keeps a running job observable after SSE disconnect and finds its real completion', async () => {
    const done = vi.fn();
    await act(async () => {
      root.render(<ReindexProgress jobId="job" onDone={done} />);
    });
    const es = FakeEventSource.instances[0]!;
    await act(async () => {
      es.dispatchEvent(new Event('error'));
    });
    expect(done).not.toHaveBeenCalled();
    expect(es.close).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Переподключаемся');
    api.getJob.mockResolvedValue({ status: 'DONE', progress: 100 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ status: 'DONE' }));
    es.dispatchEvent(new MessageEvent('done', { data: '{"status":"DONE"}' }));
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('reports failure only when the API returns FAILED', async () => {
    const done = vi.fn();
    api.getJob.mockResolvedValue({
      status: 'FAILED',
      errorMessage: 'Embedding provider rejected request',
    });
    await act(async () => {
      root.render(<ReindexProgress jobId="job" onDone={done} />);
    });
    expect(done).toHaveBeenCalledWith({
      status: 'FAILED',
      errorMessage: 'Embedding provider rejected request',
    });
  });
  it('does not replace or complete the stream when its parent rerenders', async () => {
    await act(async () => {
      root.render(<ReindexProgress jobId="job" onDone={vi.fn()} />);
    });
    await act(async () => {
      root.render(<ReindexProgress jobId="job" onDone={vi.fn()} />);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.close).not.toHaveBeenCalled();
  });
  it('recovers the server job when the knowledge page mounts after reload', async () => {
    api.getLatestIndexingJob.mockResolvedValue({ id: 'restored-job', status: 'RUNNING' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <KnowledgePage agentId="agent" />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.getLatestIndexingJob).toHaveBeenCalledWith('agent');
    expect(api.getJob).toHaveBeenCalledWith('restored-job', expect.any(AbortSignal));
    expect(FakeEventSource.instances[0]!.url).toContain('restored-job/stream');
    const reindexButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Проиндексировать'),
    );
    expect(reindexButton?.disabled).toBe(true);
    await act(async () => {
      root.unmount();
    });
    client.clear();
  });
});
