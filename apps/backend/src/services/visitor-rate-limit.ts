/**
 * Visitor rate-limit service.
 * Enforces per-visitor message/session limits and maintains block timers.
 */

import { prisma } from '../db/prisma.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Exponential block durations in minutes: 1 → 5 → 30 → 1440 (24h)
const BLOCK_STEPS_MIN = [1, 5, 30, 1440];

function blockDurationMin(attempts: number): number {
  const idx = Math.min(attempts, BLOCK_STEPS_MIN.length - 1);
  return BLOCK_STEPS_MIN[idx]!;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'blocked' | 'messages_exceeded' | 'sessions_exceeded' | 'message_too_long';
  retryAfter?: Date;
}

/** Checks and updates message count for a visitor. Call before processing the message. */
export async function checkMessageLimit(
  agentId: string,
  visitorKey: string,
  maxPerHour: number,
): Promise<RateLimitResult> {
  const now = new Date();

  let record = await prisma.visitorRateLimit.findUnique({
    where: { agentId_visitorKey: { agentId, visitorKey } },
  });

  // Check block
  if (record?.blockedUntil && record.blockedUntil > now) {
    return { allowed: false, reason: 'blocked', retryAfter: record.blockedUntil };
  }

  if (!record) {
    record = await prisma.visitorRateLimit.create({
      data: { agentId, visitorKey, messagesHour: 0, sessionsToday: 0 },
    });
  }

  // Reset hourly counter if needed
  const needsHourReset = now.getTime() - record.lastResetAt.getTime() > HOUR_MS;
  const newMessagesHour = needsHourReset ? 1 : record.messagesHour + 1;

  if (newMessagesHour > maxPerHour) {
    // Increment attempts via session-level workaround (use messagesHour as "soft block" indicator)
    const blockUntil = new Date(now.getTime() + blockDurationMin(0) * 60 * 1000);
    await prisma.visitorRateLimit.update({
      where: { agentId_visitorKey: { agentId, visitorKey } },
      data: { blockedUntil: blockUntil },
    });
    return { allowed: false, reason: 'messages_exceeded', retryAfter: blockUntil };
  }

  await prisma.visitorRateLimit.update({
    where: { agentId_visitorKey: { agentId, visitorKey } },
    data: {
      messagesHour: newMessagesHour,
      lastResetAt: needsHourReset ? now : record.lastResetAt,
      blockedUntil: null,
    },
  });

  return { allowed: true };
}

/** Checks and updates session count for a visitor. Call when creating a new session. */
export async function checkSessionLimit(
  agentId: string,
  visitorKey: string,
  maxPerDay: number,
): Promise<RateLimitResult> {
  const now = new Date();

  let record = await prisma.visitorRateLimit.findUnique({
    where: { agentId_visitorKey: { agentId, visitorKey } },
  });

  if (record?.blockedUntil && record.blockedUntil > now) {
    return { allowed: false, reason: 'blocked', retryAfter: record.blockedUntil };
  }

  if (!record) {
    record = await prisma.visitorRateLimit.create({
      data: { agentId, visitorKey, messagesHour: 0, sessionsToday: 0 },
    });
  }

  // Reset daily counter if > 24h since last reset
  const needsDayReset = now.getTime() - record.lastResetAt.getTime() > DAY_MS;
  const newSessionsToday = needsDayReset ? 1 : record.sessionsToday + 1;

  if (newSessionsToday > maxPerDay) {
    const blockUntil = new Date(now.getTime() + blockDurationMin(0) * 60 * 1000);
    await prisma.visitorRateLimit.update({
      where: { agentId_visitorKey: { agentId, visitorKey } },
      data: { blockedUntil: blockUntil },
    });
    return { allowed: false, reason: 'sessions_exceeded', retryAfter: blockUntil };
  }

  await prisma.visitorRateLimit.update({
    where: { agentId_visitorKey: { agentId, visitorKey } },
    data: {
      sessionsToday: newSessionsToday,
      lastResetAt: needsDayReset ? now : record.lastResetAt,
      blockedUntil: null,
    },
  });

  return { allowed: true };
}
