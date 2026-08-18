import { useQuery } from '@tanstack/react-query';
import { getBootstrap } from './api';
import { isLiteEdition } from './app-edition';
import { getToken, isAuthenticated } from './auth';
import type { BootstrapContext, FeatureKey } from '../types';

export function bootstrapQueryKey() {
  return bootstrapQueryKeyForToken(getToken());
}

export function bootstrapQueryKeyForToken(token: string | null) {
  return ['bootstrap', token] as const;
}

export function isFeatureEnabled(
  data: Pick<BootstrapContext, 'features'> | undefined,
  feature: FeatureKey,
): boolean {
  if (data) return data.features[feature] === true;
  return feature === 'agent.configuration';
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
  return isFeatureEnabled(data, feature);
}

export function usePlanName(): string {
  const { data } = useBootstrap();
  return data?.plan ?? (isLiteEdition ? 'Lite' : 'PRO');
}
