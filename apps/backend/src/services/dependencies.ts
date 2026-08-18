import type { FastifyRequest } from 'fastify';
import { localFileStorageAdapter } from '../adapters/storage/local-fs.js';
import type {
  AuthWorkspaceAdapter,
  JobDispatcher,
  MeteringSink,
  RealtimeEventBus,
  StorageAdapter,
} from '../contracts/infrastructure.js';
import { ApiError } from './api-errors.js';
import { getEntitlementProvider } from './entitlements.js';
import { prismaJobDispatcher } from './job-runner.js';
import { noopMeteringSink } from './metering.js';
import { inMemoryRealtimeEventBus, type HubEvent } from './realtime-hub.js';

export interface AppDependencies {
  storage: StorageAdapter;
  jobs: JobDispatcher;
  realtime: RealtimeEventBus<HubEvent>;
  authWorkspace: AuthWorkspaceAdapter;
  entitlements: ReturnType<typeof getEntitlementProvider>;
  metering: MeteringSink;
}

export class CommunityAuthWorkspaceAdapter implements AuthWorkspaceAdapter {
  async authenticateRequest(request: FastifyRequest) {
    await request.jwtVerify();
    return {
      userId: request.user.sub,
      email: request.user.email,
      tenantId: request.user.tenantId,
      role: request.user.role as 'OWNER' | 'ADMIN' | 'OPERATOR',
    };
  }

  async assertWorkspaceAccess(
    context: Awaited<ReturnType<CommunityAuthWorkspaceAdapter['authenticateRequest']>>,
    workspaceId: string,
  ): Promise<void> {
    if (context.tenantId !== workspaceId) {
      throw new ApiError('WORKSPACE_ACCESS_DENIED', { tenantId: workspaceId });
    }
  }
}

export function createCommunityDependencies(): AppDependencies {
  return {
    storage: localFileStorageAdapter,
    jobs: prismaJobDispatcher,
    realtime: inMemoryRealtimeEventBus,
    authWorkspace: new CommunityAuthWorkspaceAdapter(),
    entitlements: getEntitlementProvider(),
    metering: noopMeteringSink,
  };
}
