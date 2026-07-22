/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_EDITION?: 'pro' | 'lite';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
