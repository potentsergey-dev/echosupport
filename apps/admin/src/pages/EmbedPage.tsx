import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CopyIcon, CheckIcon } from 'lucide-react';
import { getEmbedSnippet } from '../lib/api';
import { Button } from '../components/ui/Button';

export function EmbedPage({ agentId }: { agentId: string }) {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery<{ snippet: string }>({
    queryKey: ['embed-snippet', agentId],
    queryFn: () => getEmbedSnippet(agentId),
  });

  async function handleCopy() {
    if (!data?.snippet) return;
    await navigator.clipboard.writeText(data.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Embed-код виджета</h3>
            <p className="mt-1 text-sm text-gray-500">
              Вставьте этот код в тег{' '}
              <code className="font-mono text-indigo-600">&lt;head&gt;</code> или перед закрывающим{' '}
              <code className="font-mono text-indigo-600">&lt;/body&gt;</code> вашего сайта. Origin
              сайта должен быть разрешён на вкладке «Профиль».
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleCopy()}
            disabled={!data?.snippet}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? 'Скопировано!' : 'Копировать'}
          </Button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error.message}</p>}

        {data?.snippet && (
          <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-green-300">
            <code>{data.snippet}</code>
          </pre>
        )}

        {data?.snippet && (
          <div className="mt-4 rounded-lg bg-blue-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-blue-900">Инструкция</h4>
            <ol className="list-decimal space-y-1 pl-4 text-sm text-blue-800">
              <li>Скопируйте сниппет выше.</li>
              <li>
                Вставьте его в HTML вашего сайта перед закрывающим тегом{' '}
                <code className="font-mono">&lt;/body&gt;</code>.
              </li>
              <li>
                Убедитесь, что домен вашего сайта добавлен в разрешённые источники (CORS) на вкладке
                «Профиль».
              </li>
              <li>Откройте страницу в браузере — в углу появится кнопка чата.</li>
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
