import type {
  EntitlementContext,
  EntitlementProvider,
  EntitlementService,
  EntitlementSnapshot,
  FeatureKey,
  PlanName,
  QuotaKey,
  SubscriptionState,
  TrialState,
} from '../contracts/entitlements.js';
import { ApiError } from './api-errors.js';
import { getPlanPolicySource, parsePlanName, type PlanPolicySource } from './plan-policy.js';
import { getReleaseMetadata } from './release-metadata.js';

const CACHE_TTL_MS = 60_000;

export interface TenantSubscriptionRecord {
  tenantId: string;
  plan: PlanName;
  subscriptionState: SubscriptionState;
  access: 'ALLOWED' | 'DENIED';
  accessReason?: string;
  trialState: TrialState;
  trialExpiresAt?: string;
}

export interface SubscriptionRepository {
  getTenantSubscription(tenantId: string): Promise<TenantSubscriptionRecord>;
}

export interface TenantPlanAssignmentRecord {
  tenantId: string;
  plan: PlanName;
}

export type TenantPlanAssignmentReader = (
  tenantId: string,
  at: Date,
) => Promise<TenantPlanAssignmentRecord | null>;

function entitlementEnv() {
  return {
    appEdition: process.env['APP_EDITION'] ?? 'pro',
    provider: process.env['ENTITLEMENT_PROVIDER'] ?? 'community',
    cloudTenantPlans: process.env['CLOUD_TENANT_PLANS'],
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
  };
}

function communityPresetToPlan(value: string | undefined): PlanName {
  if (value === 'lite') return 'Lite';
  if (value === 'pro' || value === undefined || value === '') return 'PRO';
  throw new Error(`Invalid APP_EDITION "${value}". Expected lite or pro.`);
}

export function parseTenantPlans(raw: string | undefined): Map<string, PlanName> {
  const plans = new Map<string, PlanName>();
  if (!raw?.trim()) return plans;

  for (const entry of raw.split(',')) {
    const [tenantId, plan] = entry.split('=').map((value) => value?.trim());
    if (!tenantId || !plan) {
      throw new Error('CLOUD_TENANT_PLANS entries must use tenantId=Lite or tenantId=PRO.');
    }
    plans.set(tenantId, parsePlanName(plan));
  }
  return plans;
}

export class DevTenantPlansSubscriptionRepository implements SubscriptionRepository {
  private readonly tenantPlans: Map<string, PlanName>;

  constructor(rawPlans: string | undefined) {
    this.tenantPlans = parseTenantPlans(rawPlans);
  }

  async getTenantSubscription(tenantId: string): Promise<TenantSubscriptionRecord> {
    return {
      tenantId,
      plan: this.tenantPlans.get(tenantId) ?? 'Lite',
      subscriptionState: 'ACTIVE',
      access: 'ALLOWED',
      trialState: 'NONE',
    };
  }
}

export class FailClosedSubscriptionRepository implements SubscriptionRepository {
  async getTenantSubscription(tenantId: string): Promise<TenantSubscriptionRecord> {
    return {
      tenantId,
      plan: 'Lite',
      subscriptionState: 'INACTIVE',
      access: 'DENIED',
      accessReason: 'subscription_repository_not_configured',
      trialState: 'NONE',
    };
  }
}

export class TenantPlanAssignmentSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly readCurrentPlanAssignment: TenantPlanAssignmentReader) {}

  async getTenantSubscription(tenantId: string): Promise<TenantSubscriptionRecord> {
    const assignment = await this.readCurrentPlanAssignment(tenantId, new Date());
    if (!assignment) {
      return {
        tenantId,
        plan: 'Lite',
        subscriptionState: 'INACTIVE',
        access: 'DENIED',
        accessReason: 'plan_assignment_not_found',
        trialState: 'NONE',
      };
    }

    return {
      tenantId,
      plan: assignment.plan,
      subscriptionState: 'ACTIVE',
      access: 'ALLOWED',
      trialState: 'NONE',
    };
  }
}

function snapshotExpiry(now: Date): string {
  return new Date(now.getTime() + CACHE_TTL_MS).toISOString();
}

async function buildSnapshot(
  tenantId: string,
  subscription: TenantSubscriptionRecord,
  policySource: PlanPolicySource,
): Promise<EntitlementSnapshot> {
  const policy = await policySource.getPolicy();
  const planPolicy = policy.plans[subscription.plan];
  const now = new Date();
  const release = getReleaseMetadata();

  return {
    releaseVersion: release.version,
    tenantId,
    plan: subscription.plan,
    features: Object.fromEntries(
      Object.entries(planPolicy.features).map(([feature, value]) => [
        feature,
        { ...value, enabled: value.enabled && subscription.access === 'ALLOWED' },
      ]),
    ) as EntitlementSnapshot['features'],
    quotas: Object.fromEntries(
      Object.entries(planPolicy.quotas).map(([quota, value]) => [quota, { ...value }]),
    ) as EntitlementSnapshot['quotas'],
    subscription: {
      state: subscription.subscriptionState,
      access: subscription.access,
      ...(subscription.accessReason ? { reason: subscription.accessReason } : {}),
      trial: {
        state: subscription.trialState,
        ...(subscription.trialExpiresAt ? { expiresAt: subscription.trialExpiresAt } : {}),
      },
    },
    policyVersion: policy.policyVersion,
    computedAt: now.toISOString(),
    expiresAt: snapshotExpiry(now),
  };
}

export class CommunityEntitlementProvider implements EntitlementProvider {
  constructor(
    private readonly appEdition = entitlementEnv().appEdition,
    private readonly policySource = getPlanPolicySource(),
  ) {}

  async getSnapshot(context: EntitlementContext): Promise<EntitlementSnapshot> {
    const subscription: TenantSubscriptionRecord = {
      tenantId: context.tenantId,
      plan: communityPresetToPlan(this.appEdition),
      subscriptionState: 'ACTIVE',
      access: 'ALLOWED',
      trialState: 'NONE',
    };
    return buildSnapshot(context.tenantId, subscription, this.policySource);
  }
}

export class CloudEntitlementProvider implements EntitlementProvider {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly policySource = getPlanPolicySource(),
  ) {}

  async getSnapshot(context: EntitlementContext): Promise<EntitlementSnapshot> {
    const subscription = await this.subscriptions.getTenantSubscription(context.tenantId);
    return buildSnapshot(context.tenantId, subscription, this.policySource);
  }
}

export function createEntitlementProvider(): EntitlementProvider {
  const env = entitlementEnv();
  if (env.provider === 'cloud') {
    if (env.nodeEnv === 'production') {
      if (env.cloudTenantPlans?.trim()) {
        throw new Error(
          'CLOUD_TENANT_PLANS is a dev/test fallback and is forbidden in production.',
        );
      }
      return new CloudEntitlementProvider(new FailClosedSubscriptionRepository());
    }
    return new CloudEntitlementProvider(
      new DevTenantPlansSubscriptionRepository(env.cloudTenantPlans),
    );
  }
  return new CommunityEntitlementProvider();
}

let provider: EntitlementProvider | null = null;
let service: EntitlementService | null = null;

export function getEntitlementProvider(): EntitlementProvider {
  provider ??= createEntitlementProvider();
  return provider;
}

export function setEntitlementProviderForTests(next: EntitlementProvider | null): void {
  provider = next;
  service = next ? createEntitlementService(next) : null;
}

export async function getEntitlements(context: EntitlementContext): Promise<EntitlementSnapshot> {
  return getEntitlementService().getSnapshot(context);
}

function assertSubscriptionAccess(snapshot: EntitlementSnapshot, tenantId: string): void {
  if (snapshot.subscription.trial.state === 'EXPIRED') {
    throw new ApiError('TRIAL_EXPIRED', {
      tenantId,
      plan: snapshot.plan,
    });
  }
  if (snapshot.subscription.access !== 'ALLOWED' || snapshot.subscription.state === 'INACTIVE') {
    throw new ApiError('SUBSCRIPTION_INACTIVE', {
      tenantId,
      plan: snapshot.plan,
    });
  }
}

export async function assertFeature(
  context: EntitlementContext,
  feature: FeatureKey,
): Promise<EntitlementSnapshot> {
  return getEntitlementService().assertFeature(context, feature);
}

export async function assertQuota(
  context: EntitlementContext,
  quota: QuotaKey,
  quantity: number,
  readCurrentUsage: () => Promise<number>,
): Promise<EntitlementSnapshot> {
  return getEntitlementService().assertQuota(context, quota, quantity, readCurrentUsage);
}

export function createEntitlementService(provider: EntitlementProvider): EntitlementService {
  return {
    getSnapshot: (context) => provider.getSnapshot(context),
    async assertFeature(context, feature) {
      const snapshot = await provider.getSnapshot(context);
      assertSubscriptionAccess(snapshot, context.tenantId);
      if (!snapshot.features[feature]?.enabled) {
        throw new ApiError('FEATURE_NOT_AVAILABLE', {
          tenantId: context.tenantId,
          plan: snapshot.plan,
          feature,
        });
      }
      return snapshot;
    },
    async assertQuota(context, quota, quantity, readCurrentUsage) {
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error('Quota quantity must be a positive safe integer.');
      }

      const snapshot = await provider.getSnapshot(context);
      assertSubscriptionAccess(snapshot, context.tenantId);
      const quotaSnapshot = snapshot.quotas[quota];
      if (!quotaSnapshot.enforced || quotaSnapshot.limit === null) return snapshot;

      const used = await readCurrentUsage();
      if (used + quantity > quotaSnapshot.limit) {
        throw new ApiError('QUOTA_EXCEEDED', {
          tenantId: context.tenantId,
          plan: snapshot.plan,
          quota,
          limit: quotaSnapshot.limit,
          used,
        });
      }
      return snapshot;
    },
  };
}

export function getEntitlementService(): EntitlementService {
  service ??= createEntitlementService(getEntitlementProvider());
  return service;
}
