import { useQuery } from '@tanstack/react-query';
import { getBootstrap } from './api';
import { isLiteEdition } from './app-edition';
import { getToken, isAuthenticated } from './auth';
import type { BootstrapContext, FeatureKey } from '../types';

export function bootstrapQueryKey() {
  return ['bootstrap', getToken()] as const;
}

export function useBootstrap() {
  return useQuery<BootstrapContext>({
    queryKey: bootstrapQueryKey(),
    queryFn: getBootstrap,
    enabled: isAuthenticated(),
    staleTime: 30_000,
  });
}

export function useFeature(feature: FeatureKey): boolean {
  const { data } = useBootstrap();
  if (data) return data.features[feature] === true;

  if (feature === 'agent.configuration') return true;
  return false;
}

export function usePlanName(): string {
  const { data } = useBootstrap();
  return data?.plan ?? (isLiteEdition ? 'Lite' : 'PRO');
}
