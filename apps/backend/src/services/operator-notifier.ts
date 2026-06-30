/**
 * Operator notification outbox worker.
 * Runs every 10 seconds, picks PENDING notifications, delivers them.
 *
 * Phase 10.5: browser push via VAPID (web-push) + in-app via WebSocket hub.
 * Email (Resend) and Telegram hooks can be wired in later.
 */

import { prisma } from '../db/prisma.js';
import { publishToOperators } from './realtime-hub.js';

let interval: ReturnType<typeof setInterval> | null = null;

export async function startOperatorNotifier(): Promise<void> {
  if (interval) return;
  interval = setInterval(() => void processNotifications(), 10_000);
}

export function stopOperatorNotifier(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

async function processNotifications(): Promise<void> {
  // Pick up to 20 PENDING notifications older than 1 second
  const pending = await prisma.operatorNotification.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lte: new Date(Date.now() - 1000) },
    },
    take: 20,
    orderBy: { createdAt: 'asc' },
  });

  for (const notif of pending) {
    try {
      // In-app (WebSocket) delivery — always attempted
      publishToOperators(notif.tenantId, {
        type: 'session:new',
        tenantId: notif.tenantId,
        session: notif.payload as Record<string, unknown> as Parameters<
          typeof publishToOperators
        >[1] extends { session: infer S }
          ? S
          : never,
      });

      // Web Push delivery (if push subscriptions exist for the target user)
      if (notif.channels.includes('browser')) {
        await deliverBrowserPush(notif);
      }

      await prisma.operatorNotification.update({
        where: { id: notif.id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
    } catch (err) {
      const newAttempts = notif.attempts + 1;
      await prisma.operatorNotification.update({
        where: { id: notif.id },
        data: {
          attempts: newAttempts,
          status: newAttempts >= 3 ? 'FAILED' : 'PENDING',
        },
      });
    }
  }
}

async function deliverBrowserPush(
  notif: Awaited<ReturnType<typeof prisma.operatorNotification.findMany>>[0],
): Promise<void> {
  // Find push subscriptions for target users
  let subscriptions: Awaited<ReturnType<typeof prisma.pushSubscription.findMany>>;

  if (notif.userId) {
    // Targeted delivery to a specific user
    subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: notif.userId },
    });
  } else {
    // Broadcast: deliver to all operators in the tenant
    const tenantUsers = await prisma.user.findMany({
      where: { tenantId: notif.tenantId },
      select: { id: true },
    });
    subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: tenantUsers.map((u) => u.id) } },
    });
  }

  if (subscriptions.length === 0) return;

  // web-push is an optional dependency — import dynamically
  interface WebPushLib {
    setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
    sendNotification: (
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
    ) => Promise<unknown>;
  }
  let webpush: WebPushLib | undefined;
  try {
    webpush = (await import('web-push')) as unknown as WebPushLib;
  } catch {
    // web-push not installed — skip browser push
    return;
  }

  const vapidPublic = process.env['VAPID_PUBLIC_KEY'];
  const vapidPrivate = process.env['VAPID_PRIVATE_KEY'];
  const vapidSubject = process.env['VAPID_SUBJECT'] ?? 'mailto:admin@example.com';

  if (!vapidPublic || !vapidPrivate) return;

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const payload = JSON.stringify({
    title: notif.type === 'HANDOFF_REQUESTED' ? 'New handoff request' : 'Notification',
    body: (notif.payload as Record<string, unknown>)['snippet'] ?? '',
    data: notif.payload,
  });

  if (!webpush) return;

  await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ),
    ),
  );
}
