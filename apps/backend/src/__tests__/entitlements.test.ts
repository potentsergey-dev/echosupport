import { describe, expect, it } from 'vitest';
import {
  assertFeature,
  assertQuota,
  CloudEntitlementProvider,
  CommunityEntitlementProvider,
  DevTenantPlansSubscriptionRepository,
  parseTenantPlans,
  setEntitlementProviderForTests,
  TenantPlanAssignmentSubscriptionRepository,
  type SubscriptionRepository,
} from '../services/entitlements.js';

describe('EntitlementProvider contract', () => {
  it('keeps Community Lite as a self-hosted runtime policy preset', async () => {
    const provider = new CommunityEntitlementProvider('lite');
    const snapshot = await provider.getSnapshot({ tenantId: 'tenant-lite' });

    expect(snapshot.plan).toBe('Lite');
    expect(snapshot.features['agent.configuration'].enabled).toBe(true);
    expect(snapshot.features['operator.inbox'].enabled).toBe(false);
    expect(snapshot.quotas.agents).toMatchObject({ limit: 1, enforced: true });
    expect(snapshot.releaseVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(snapshot.policyVersion).toBeTruthy();
    expect(snapshot.subscription).toMatchObject({
      state: 'ACTIVE',
      access: 'ALLOWED',
      trial: { state: 'NONE' },
    });
    expect(Date.parse(snapshot.computedAt)).not.toBeNaN();
    expect(Date.parse(snapshot.expiresAt)).not.toBeNaN();
  });

  it('keeps Community PRO available as a self-hosted preset', async () => {
    const provider = new CommunityEntitlementProvider('pro');
    const snapshot = await provider.getSnapshot({ tenantId: 'tenant-pro' });

    expect(snapshot.plan).toBe('PRO');
    expect(snapshot.features['booking.workflow'].enabled).toBe(true);
    expect(snapshot.features['voice.stt'].enabled).toBe(true);
  });

  it('serves Lite and PRO tenants from one Cloud provider instance', async () => {
    const provider = new CloudEntitlementProvider(
      new DevTenantPlansSubscriptionRepository('tenant-a=PRO,tenant-b=Lite'),
    );
    const pro = await provider.getSnapshot({ tenantId: 'tenant-a' });
    const lite = await provider.getSnapshot({ tenantId: 'tenant-b' });

    expect(pro.plan).toBe('PRO');
    expect(pro.features['booking.workflow'].enabled).toBe(true);
    expect(lite.plan).toBe('Lite');
    expect(lite.features['booking.workflow'].enabled).toBe(false);
  });

  it('does not leak PRO entitlements to another tenant', async () => {
    const provider = new CloudEntitlementProvider(
      new DevTenantPlansSubscriptionRepository('tenant-pro=PRO'),
    );
    const pro = await provider.getSnapshot({ tenantId: 'tenant-pro' });
    const unrelated = await provider.getSnapshot({ tenantId: 'tenant-lite' });

    expect(pro.features['human.handoff'].enabled).toBe(true);
    expect(unrelated.features['human.handoff'].enabled).toBe(false);
  });

  it('accepts only exact Lite and PRO plan values in Cloud fallback config', () => {
    expect(parseTenantPlans('a=PRO,b=Lite')).toEqual(
      new Map([
        ['a', 'PRO'],
        ['b', 'Lite'],
      ]),
    );
    expect(() => parseTenantPlans('b=Light')).toThrow(/Expected exactly Lite or PRO/);
    expect(() => parseTenantPlans('b=Ligt')).toThrow(/Expected exactly Lite or PRO/);
    expect(() => parseTenantPlans('b=pro')).toThrow(/Expected exactly Lite or PRO/);
  });

  it('returns subscription inactive contract before feature access', async () => {
    const repository: SubscriptionRepository = {
      async getTenantSubscription(tenantId) {
        return {
          tenantId,
          plan: 'PRO',
          subscriptionState: 'INACTIVE',
          access: 'DENIED',
          accessReason: 'past_due',
          trialState: 'NONE',
        };
      },
    };
    const provider = new CloudEntitlementProvider(repository);
    const snapshot = await provider.getSnapshot({ tenantId: 'tenant-inactive' });

    expect(snapshot.subscription).toMatchObject({
      state: 'INACTIVE',
      access: 'DENIED',
      reason: 'past_due',
    });
  });

  it('reads Cloud plans from durable tenant plan assignments', async () => {
    const repository = new TenantPlanAssignmentSubscriptionRepository(async (tenantId) =>
      tenantId === 'tenant-pro' ? { tenantId, plan: 'PRO' } : null,
    );
    const provider = new CloudEntitlementProvider(repository);

    const pro = await provider.getSnapshot({ tenantId: 'tenant-pro' });
    const missing = await provider.getSnapshot({ tenantId: 'tenant-missing' });

    expect(pro.plan).toBe('PRO');
    expect(pro.subscription).toMatchObject({
      state: 'ACTIVE',
      access: 'ALLOWED',
      trial: { state: 'NONE' },
    });
    expect(missing.plan).toBe('Lite');
    expect(missing.subscription).toMatchObject({
      state: 'INACTIVE',
      access: 'DENIED',
      reason: 'plan_assignment_not_found',
    });
  });

  it('uses one quota contract with operation quantity and current usage callback', async () => {
    setEntitlementProviderForTests(new CommunityEntitlementProvider('lite'));
    try {
      await expect(
        assertQuota({ tenantId: 'tenant-lite' }, 'agents', 1, async () => 1),
      ).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
        details: { quota: 'agents', limit: 1, used: 1 },
      });
    } finally {
      setEntitlementProviderForTests(null);
    }
  });

  it('returns trial expired before feature access', async () => {
    const repository: SubscriptionRepository = {
      async getTenantSubscription(tenantId) {
        return {
          tenantId,
          plan: 'PRO',
          subscriptionState: 'TRIALING',
          access: 'DENIED',
          accessReason: 'trial_expired',
          trialState: 'EXPIRED',
          trialExpiresAt: '2026-08-01T00:00:00.000Z',
        };
      },
    };
    const provider = new CloudEntitlementProvider(repository);
    setEntitlementProviderForTests(provider);
    try {
      await expect(
        assertFeature({ tenantId: 'tenant-trial' }, 'booking.workflow'),
      ).rejects.toMatchObject({
        code: 'TRIAL_EXPIRED',
        details: { tenantId: 'tenant-trial', plan: 'PRO' },
      });
    } finally {
      setEntitlementProviderForTests(null);
    }

    const snapshot = await provider.getSnapshot({ tenantId: 'tenant-trial' });
    expect(snapshot.subscription.trial).toMatchObject({ state: 'EXPIRED' });
  });
});
