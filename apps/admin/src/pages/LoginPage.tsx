import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BotIcon } from 'lucide-react';
import { login } from '../lib/api';
import { setToken, setRole } from '../lib/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await login(email, password);
      setToken(token);
      setRole(user.role);
      navigate('/agents');
    } catch (err) {
      setError((err as Error).message ?? 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600">
            <BotIcon size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">EchoSupport</h1>
          <p className="mt-1 text-sm text-gray-500">Войдите в панель управления</p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-xl bg-white p-8 shadow-sm border border-gray-200"
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@local.test"
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Войти
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
