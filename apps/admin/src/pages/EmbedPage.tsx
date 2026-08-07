import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CopyIcon, CheckIcon, ExternalLinkIcon } from 'lucide-react';
import { getEmbedSnippet } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

const SOCIAL_SOURCES = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'vk', label: 'VK' },
  { value: 'ads', label: 'Реклама' },
  { value: 'directory', label: 'Каталог / профиль' },
];

function createSocialLaunchLink(pageUrl: string, source: string, scenario: string): string | null {
  try {
    const url = new URL(pageUrl.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.searchParams.set('chat', 'open');
    url.searchParams.set('source', source);
    if (scenario.trim()) url.searchParams.set('scenario', scenario.trim());
    return url.toString();
  } catch {
    return null;
  }
}

export function EmbedPage({ agentId }: { agentId: string }) {
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [socialPageUrl, setSocialPageUrl] = useState('');
  const [socialSource, setSocialSource] = useState('instagram');
  const [socialScenario, setSocialScenario] = useState('');
  const [copiedSocialLink, setCopiedSocialLink] = useState(false);

  const { data, isLoading, error } = useQuery<{
    snippet: string;
    agentKey: string;
    publicBaseUrl: string;
  }>({
    queryKey: ['embed-snippet', agentId],
    queryFn: () => getEmbedSnippet(agentId),
  });

  const socialLink = createSocialLaunchLink(socialPageUrl, socialSource, socialScenario);

  async function handleCopy() {
    if (!data?.snippet) return;
    await navigator.clipboard.writeText(data.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyKey() {
    if (!data?.agentKey) return;
    await navigator.clipboard.writeText(data.agentKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  async function handleCopySocialLink() {
    if (!socialLink) return;
    await navigator.clipboard.writeText(socialLink);
    setCopiedSocialLink(true);
    setTimeout(() => setCopiedSocialLink(false), 2000);
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

        {data?.agentKey && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Public agent key</h4>
                <code className="mt-1 block break-all font-mono text-xs text-gray-600">
                  {data.agentKey}
                </code>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleCopyKey()}
                disabled={!data.agentKey}
              >
                {copiedKey ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                {copiedKey ? 'Скопировано!' : 'Ключ'}
              </Button>
            </div>
          </div>
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

        {data?.agentKey && (
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <h4 className="mb-2 text-sm font-semibold text-gray-900">Локальная проверка</h4>
            <p className="text-sm text-gray-600">
              Запустите <code className="font-mono">pnpm --filter @echosupport/widget dev</code> и
              откройте локальный предпросмотр с этим ключом:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-white p-3 text-xs text-gray-700">
              <code>{`http://localhost:5173/demo.html?agentKey=${data.agentKey}&apiBase=${data.publicBaseUrl}`}</code>
            </pre>
          </div>
        )}
      </section>

      {data?.snippet && (
        <section className="rounded-xl border border-violet-200 bg-violet-50 p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-violet-100 p-2 text-violet-700">
              <ExternalLinkIcon size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-violet-950">
                Ссылки для соцсетей и рекламы
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-violet-900">
                Instagram, TikTok, YouTube, Telegram, VK и рекламные площадки не позволяют вставить
                JavaScript-виджет в профиль или публикацию. Разместите ссылку на страницу вашего
                сайта, где виджет уже установлен: он откроется автоматически.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-violet-950">
              Страница сайта с установленным виджетом
              <Input
                className="mt-1 border-violet-200 bg-white"
                type="url"
                inputMode="url"
                placeholder="https://example.com/consultation"
                value={socialPageUrl}
                onChange={(event) => setSocialPageUrl(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-violet-950">
              Канал перехода
              <select
                className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={socialSource}
                onChange={(event) => setSocialSource(event.target.value)}
              >
                {SOCIAL_SOURCES.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-violet-950 md:col-span-2">
              Сценарий кампании <span className="font-normal text-violet-700">(необязательно)</span>
              <Input
                className="mt-1 border-violet-200 bg-white"
                placeholder="booking, consultation, sale"
                maxLength={80}
                value={socialScenario}
                onChange={(event) => setSocialScenario(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-violet-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
              Готовая ссылка
            </p>
            {socialLink ? (
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all text-sm text-gray-800">{socialLink}</code>
                <Button size="sm" onClick={() => void handleCopySocialLink()}>
                  {copiedSocialLink ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  {copiedSocialLink ? 'Скопировано!' : 'Копировать ссылку'}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-600">
                Введите полный адрес страницы, начиная с https://.
              </p>
            )}
          </div>

          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm leading-6 text-violet-950">
            <li>
              Сначала установите виджет на указанную страницу и добавьте её домен в «Профиль».
            </li>
            <li>
              Скопируйте готовую ссылку в bio, публикацию, рекламное объявление или кнопку профиля.
            </li>
            <li>
              Параметр <code className="font-mono">chat=open</code> открывает чат;{' '}
              <code className="font-mono">source</code> и{' '}
              <code className="font-mono">scenario</code> сохраняются в URL страницы в контексте
              обращения и подходят для внешней аналитики.
            </li>
          </ol>
        </section>
      )}
    </div>
  );
}
