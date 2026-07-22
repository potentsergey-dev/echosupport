export type AppEdition = 'pro' | 'lite';

const rawEdition = (import.meta.env['VITE_APP_EDITION'] as string | undefined)?.toLowerCase();

export const appEdition: AppEdition = rawEdition === 'lite' ? 'lite' : 'pro';
export const isLiteEdition = appEdition === 'lite';
