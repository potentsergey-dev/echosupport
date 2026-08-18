import rawPolicy from '../config/plan-policies.community.json' with { type: 'json' };
import type {
  EntitlementFeature,
  EntitlementQuota,
  FeatureKey,
  PlanName,
  QuotaKey,
} from '../contracts/entitlements.js';

export interface PlanPolicy {
  policyVersion: string;
  plans: Record<
    PlanName,
    {
      features: Record<FeatureKey, EntitlementFeature>;
      quotas: Record<QuotaKey, EntitlementQuota>;
    }
  >;
}

export interface PlanPolicySource {
  getPolicy(): Promise<PlanPolicy>;
}

export function parsePlanName(value: string | undefined): PlanName {
  if (value === 'Lite' || value === 'PRO') return value;
  throw new Error(`Invalid plan "${value ?? ''}". Expected exactly Lite or PRO.`);
}

function normalizeRawPolicy(): PlanPolicy {
  const policy = rawPolicy as unknown as {
    policyVersion: string;
    plans: Record<
      PlanName,
      {
        features: Record<FeatureKey, boolean>;
        quotas: Record<QuotaKey, EntitlementQuota>;
      }
    >;
  };
  return {
    policyVersion: policy.policyVersion,
    plans: {
      Lite: {
        features: Object.fromEntries(
          Object.entries(policy.plans.Lite.features).map(([feature, enabled]) => [
            feature,
            { enabled, source: 'plan' },
          ]),
        ) as Record<FeatureKey, EntitlementFeature>,
        quotas: policy.plans.Lite.quotas,
      },
      PRO: {
        features: Object.fromEntries(
          Object.entries(policy.plans.PRO.features).map(([feature, enabled]) => [
            feature,
            { enabled, source: 'plan' },
          ]),
        ) as Record<FeatureKey, EntitlementFeature>,
        quotas: policy.plans.PRO.quotas,
      },
    },
  };
}

export class StaticPlanPolicySource implements PlanPolicySource {
  constructor(private readonly policy = normalizeRawPolicy()) {}

  async getPolicy(): Promise<PlanPolicy> {
    return this.policy;
  }
}

let policySource: PlanPolicySource | null = null;

export function getPlanPolicySource(): PlanPolicySource {
  policySource ??= new StaticPlanPolicySource();
  return policySource;
}

export function setPlanPolicySourceForTests(next: PlanPolicySource | null): void {
  policySource = next;
}
