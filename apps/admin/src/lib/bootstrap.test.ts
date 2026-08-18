import { describe, expect, it } from 'vitest';
import type { BootstrapContext, FeatureKey } from '../types';
import { bootstrapQueryKeyForToken, isFeatureEnabled } from './bootstrap';

const featureKeys: FeatureKey[] = [
  'agent.configuration',
  'operator.inbox',
  'human.handoff',
  'specialists.services',
  'booking.workflow',
  'voice.stt',
  'analytics.pro',
  'branding.pro',
];

function bootstrap(features: Partial<Record<FeatureKey, boolean>>): BootstrapContext {
  return {
    user: { id: 'user-1', email: 'owner@example.com', role: 'OWNER' },
    workspace: { id: 'tenant-1', tenantId: 'tenant-1' },
    plan: 'Lite',
    features: Object.fromEntries(featureKeys.map((key) => [key, features[key] === true])) as Record<
      FeatureKey,
      boolean
    >,
    quotas: {},
    subscription: { state: 'ACTIVE', access: 'ALLOWED' },
    policyVersion: 'test-policy',
    computedAt: '2026-08-18T00:00:00.000Z',
    expiresAt: '2026-08-18T00:01:00.000Z',
  };
}

describe('admin bootstrap gates', () => {
  it('fails closed for paid features before bootstrap completes', () => {
    expect(isFeatureEnabled(undefined, 'agent.configuration')).toBe(true);
    expect(isFeatureEnabled(undefined, 'operator.inbox')).toBe(false);
    expect(isFeatureEnabled(undefined, 'booking.workflow')).toBe(false);
    expect(isFeatureEnabled(undefined, 'analytics.pro')).toBe(false);
    expect(isFeatureEnabled(undefined, 'specialists.services')).toBe(false);
  });

  it('keeps operator inbox, booking, analytics and specialists gates independent', () => {
    const data = bootstrap({
      'agent.configuration': true,
      'operator.inbox': true,
      'booking.workflow': false,
      'analytics.pro': true,
      'specialists.services': false,
    });

    expect(isFeatureEnabled(data, 'operator.inbox')).toBe(true);
    expect(isFeatureEnabled(data, 'booking.workflow')).toBe(false);
    expect(isFeatureEnabled(data, 'analytics.pro')).toBe(true);
    expect(isFeatureEnabled(data, 'specialists.services')).toBe(false);
  });

  it('hides PRO admin routes for Lite feature snapshots', () => {
    const lite = bootstrap({ 'agent.configuration': true });
    expect(isFeatureEnabled(lite, 'operator.inbox')).toBe(false);
    expect(isFeatureEnabled(lite, 'booking.workflow')).toBe(false);
    expect(isFeatureEnabled(lite, 'analytics.pro')).toBe(false);
    expect(isFeatureEnabled(lite, 'specialists.services')).toBe(false);
  });

  it('separates bootstrap cache entries by auth token', () => {
    expect(bootstrapQueryKeyForToken('token-user-a-workspace-a')).not.toEqual(
      bootstrapQueryKeyForToken('token-user-b-workspace-b'),
    );
    expect(bootstrapQueryKeyForToken(null)).toEqual(['bootstrap', null]);
  });
});
