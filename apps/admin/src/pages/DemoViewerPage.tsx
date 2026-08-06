import { LogOutIcon, MessageCircleIcon, ShieldCheckIcon } from 'lucide-react';
import { clearRole, clearToken } from '../lib/auth';

export function DemoViewerPage() {
  function leave() {
    clearToken();
    clearRole();
    window.location.assign('/admin/login');
  }
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/30 bg-indigo-400/10 px-3 py-1 text-sm text-indigo-200">
          <ShieldCheckIcon size={16} /> Временный доступ только для просмотра
        </div>
        <h1 className="mt-6 text-4xl font-bold">Демо EchoSupport</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
          Вы можете безопасно познакомиться с публичным агентом. Настройки, диалоги и записи
          защищены от изменений в этом режиме.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-white/10 p-4">
            <strong>1. Откройте чат</strong>
            <p className="mt-2 text-sm text-slate-300">Задайте вопрос на демонстрационном сайте.</p>
          </div>
          <div className="rounded-xl bg-white/10 p-4">
            <strong>2. Проверьте сценарий</strong>
            <p className="mt-2 text-sm text-slate-300">Попробуйте знания, эскалацию или запись.</p>
          </div>
          <div className="rounded-xl bg-white/10 p-4">
            <strong>3. Обсудите выводы</strong>
            <p className="mt-2 text-sm text-slate-300">
              Доступ завершается автоматически в указанный срок.
            </p>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400"
          >
            <MessageCircleIcon size={17} /> Открыть живое демо
          </a>
          <button
            type="button"
            onClick={leave}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-slate-200 hover:bg-white/10"
          >
            <LogOutIcon size={17} /> Выйти
          </button>
        </div>
      </div>
    </main>
  );
}
