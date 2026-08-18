import { Navigate } from 'react-router-dom';
import { isAuthenticated } from '../lib/auth';
import { useBootstrap } from '../lib/bootstrap';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authenticated = isAuthenticated();
  const bootstrap = useBootstrap();
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  if (bootstrap.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-600">
        Загрузка рабочего пространства...
      </div>
    );
  }
  if (bootstrap.isError || !bootstrap.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 text-sm text-red-700 shadow-sm">
          Не удалось загрузить доступы рабочего пространства. Обновите страницу или войдите снова.
        </div>
      </div>
    );
  }
  if (bootstrap.data.subscription.access !== 'ALLOWED') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md rounded-lg border border-amber-200 bg-white p-6 text-sm text-amber-800 shadow-sm">
          Доступ к рабочему пространству временно ограничен.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
