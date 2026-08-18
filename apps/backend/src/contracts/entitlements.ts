export type ReleaseVersion = string;
export type PlanName = 'Lite' | 'PRO';
export type SubscriptionState = 'ACTIVE' | 'TRIALING' | 'INACTIVE' | 'PAST_DUE' | 'CANCELLED';
export type AccessState = 'ALLOWED' | 'DENIED';
export type TrialState = 'NONE' | 'ACTIVE' | 'EXPIRED';

export type FeatureKey =
  | 'agent.configuration'
  | 'operator.inbox'
  | 'human.handoff'
  | 'specialists.services'
  | 'booking.workflow'
  | 'voice.stt'
  | 'analytics.pro'
  | 'branding.pro';

export type QuotaKey =
  | 'agents'
  | 'knowledge.documents'
  | 'knowledge.sources'
  | 'visitor.messagesPerHour'
  | 'visitor.sessionsPerDay'
  | 'voice.minutesPerMonth'
  | 'appointmentsPerMonth';

export interface EntitlementFeature {
  enabled: boolean;
  source: 'plan' | 'feature_flag' | 'override';
}

export interface EntitlementQuota {
  limit: number | null;
  used?: number;
  unit: 'count' | 'messages' | 'sessions' | 'minutes' | 'appointments';
  enforced: boolean;
}

export interface EntitlementSnapshot {
  releaseVersion: ReleaseVersion;
  tenantId: string;
  plan: PlanName;
  features: Record<FeatureKey, EntitlementFeature>;
  quotas: Record<QuotaKey, EntitlementQuota>;
  subscription: {
    state: SubscriptionState;
    access: AccessState;
    reason?: string;
    trial: {
      state: TrialState;
      expiresAt?: string;
    };
  };
  policyVersion: string;
  computedAt: string;
  expiresAt: string;
}

export interface EntitlementContext {
  tenantId: string;
  userId?: string;
}

export interface EntitlementProvider {
  getSnapshot(context: EntitlementContext): Promise<EntitlementSnapshot>;
}
