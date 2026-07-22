import { useEffect, useState } from 'react';

const WORKING_MODE_KEY = 'es_working_mode';
const WORKING_MODE_EVENT = 'es-working-mode-change';

export function isWorkingMode(): boolean {
  return localStorage.getItem(WORKING_MODE_KEY) === '1';
}

export function setWorkingMode(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(WORKING_MODE_KEY, '1');
  } else {
    localStorage.removeItem(WORKING_MODE_KEY);
  }
  window.dispatchEvent(new Event(WORKING_MODE_EVENT));
}

export function clearWorkingMode(): void {
  setWorkingMode(false);
}

export function useWorkingMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() => isWorkingMode());

  useEffect(() => {
    function sync() {
      setEnabled(isWorkingMode());
    }

    window.addEventListener(WORKING_MODE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(WORKING_MODE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [enabled, setWorkingMode];
}
