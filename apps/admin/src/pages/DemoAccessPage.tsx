import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveDemoAccessRequest,
  listDemoAccessRequests,
  rejectDemoAccessRequest,
  revokeDemoAccessRequest,
  type DemoAccessRequest,
} from '../lib/api';
import { Button } from '../components/ui/Button';
import { useToastContext } from '../components/Layout';

const statusLabel: Record<DemoAccessRequest['status'], string> = {
  PENDING: 'Новая',
  APPROVED: 'Доступ выдан',
  REJECTED: 'Отклонена',
  REVOKED: 'Отозвана',
};

export function DemoAccessPage() {
  const queryClient = useQueryClient();
  const { addToast } = useToastContext();
  const [issued, setIssued] = useState<{
    email: string;
    password: string;
    expiresAt: string;
    loginUrl: string;
  } | null>(null);
  const {
    data: requests = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['demo-access-requests'], queryFn: listDemoAccessRequests });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['demo-access-requests'] });
  const approve = useMutation({
    mutationFn: (id: string) => approveDemoAccessRequest(id),
    onSuccess: (data) => {
      setIssued(data);
      refresh();
      addToast('Временный доступ создан. Передайте данные заявителю отдельным каналом.', 'success');
    },
    onError: (err) => addToast(err.message, 'error'),
  });
  const reject = useMutation({
    mutationFn: rejectDemoAccessRequest,
    onSuccess: refresh,
    onError: (err) => addToast(err.message, 'error'),
  });
  const revoke = useMutation({
    mutationFn: revokeDemoAccessRequest,
    onSuccess: refresh,
    onError: (err) => addToast(err.message, 'error'),
  });
  const copyInvite = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(
      `Доступ к демо-панели EchoSupport\n${issued.loginUrl}\nEmail: ${issued.email}\nВременный пароль: ${issued.password}\nДоступ действует до: ${new Date(issued.expiresAt).toLocaleString('ru-RU')}`,
    );
    addToast('Приглашение скопировано. Отправьте его заявителю отдельным сообщением.', 'success');
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold text-gray-900">Доступ к демо</h1>
      <p className="mt-2 max-w-3xl text-sm text-gray-600">
        Здесь видны заявки с публичного сайта. Выдавайте только временный режим просмотра: он не
        позволяет менять агентов, чаты или записи. Пароль показывается только один раз — скопируйте
        и отправьте его заявителю по отдельному каналу.
      </p>
      {issued && (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="font-semibold">Приглашение готово для {issued.email}</div>
          <div className="mt-2 break-all">{issued.loginUrl}</div>
          <div className="mt-1">
            Временный пароль: <code className="rounded bg-white px-1">{issued.password}</code>
          </div>
          <div className="mt-1">Истекает: {new Date(issued.expiresAt).toLocaleString('ru-RU')}</div>
          <Button size="sm" className="mt-3" onClick={() => void copyInvite()}>
            Скопировать приглашение
          </Button>
        </div>
      )}
      {isLoading && <p className="mt-8 text-sm text-gray-500">Загружаем заявки…</p>}
      {error && <p className="mt-8 text-sm text-red-600">{error.message}</p>}
      {!isLoading && (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {requests.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">Заявок пока нет.</p>
          ) : (
            requests.map((request) => (
              <div key={request.id} className="border-b border-gray-100 p-4 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">
                      {request.name} · {request.email}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {request.company || 'Компания не указана'} ·{' '}
                      {new Date(request.createdAt).toLocaleString('ru-RU')} ·{' '}
                      {statusLabel[request.status]}
                    </div>
                    <p className="mt-2 max-w-3xl text-sm text-gray-700">{request.purpose}</p>
                    {request.expiresAt && (
                      <p className="mt-2 text-xs text-gray-500">
                        Доступ до {new Date(request.expiresAt).toLocaleString('ru-RU')}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {request.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          loading={approve.isPending}
                          onClick={() => approve.mutate(request.id)}
                        >
                          Выдать на 24 ч
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={reject.isPending}
                          onClick={() => reject.mutate(request.id)}
                        >
                          Отклонить
                        </Button>
                      </>
                    )}
                    {request.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={revoke.isPending}
                        onClick={() => revoke.mutate(request.id)}
                      >
                        Отозвать
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
