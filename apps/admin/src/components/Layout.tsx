import { Sidebar } from './Sidebar';
import { ToastContainer } from './ui/ToastContainer';
import { useToast } from '../hooks/useToast';
import { createContext, useContext } from 'react';

interface ToastContextValue {
  addToast: (message: string, type?: 'success' | 'error') => void;
}

export const ToastContext = createContext<ToastContextValue>({ addToast: () => undefined });

export function useToastContext() {
  return useContext(ToastContext);
}

export function Layout({
  children,
  activeAgentId,
}: {
  children: React.ReactNode;
  activeAgentId?: string | undefined;
}) {
  const { toasts, addToast, removeToast } = useToast();

  return (
    <ToastContext.Provider value={{ addToast }}>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar activeAgentId={activeAgentId} />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </ToastContext.Provider>
  );
}
