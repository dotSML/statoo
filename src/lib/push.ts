import webpush from 'web-push';
import { getPool, ensureMigrated } from './db';

const vapidEmail = 'mailto:admin@statoo.local';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    vapidEmail,
    vapidPublicKey,
    vapidPrivateKey
  );
} else {
  console.warn('VAPID keys are missing from environment. Push notifications will not be sent.');
}

export interface PushKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: PushKeys;
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
}

interface PushSendStats {
  total: number;
  sent: number;
  failed: number;
}

/**
 * Save a push subscription to the database.
 */
export async function saveSubscription(endpoint: string, keys: PushKeys): Promise<void> {
  await ensureMigrated();
  const db = getPool();

  await db.query(
    `INSERT INTO push_subscriptions (endpoint, keys)
     VALUES ($1, $2)
     ON CONFLICT (endpoint) DO UPDATE SET keys = $2`,
    [endpoint, JSON.stringify(keys)]
  );
}

/**
 * Remove a push subscription from the database.
 */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await ensureMigrated();
  const db = getPool();

  await db.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1',
    [endpoint]
  );
}

/**
 * Send a push notification to all stored subscriptions when a service goes down.
 */
export async function notifyOutage(serviceName: string, status: string): Promise<void> {
  const statusMap: Record<string, string> = {
    major_outage: 'Major Outage 🔴',
    partial_outage: 'Partial Outage 🟡',
    degraded: 'Degraded Performance 🟠',
  };

  const statusText = statusMap[status] || status;

  const payload = {
    title: `${serviceName} is DOWN`,
    body: `Status changed to: ${statusText}`,
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    url: '/',
  };

  await sendPushToAll(payload);
}

/**
 * Send an admin-triggered test push notification to all stored subscriptions.
 */
export async function sendTestNotification(): Promise<PushSendStats> {
  const payload: PushPayload = {
    title: 'Test Notification from Statoo',
    body: 'Push notifications are configured correctly.',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    url: '/admin',
  };

  return sendPushToAll(payload);
}

async function sendPushToAll(payload: PushPayload): Promise<PushSendStats> {
  await ensureMigrated();
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      keys JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await db.query('SELECT endpoint, keys FROM push_subscriptions');
  if (rows.length === 0) {
    return { total: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  const notificationPromises = rows.map(async (row) => {
    const subscription = {
      endpoint: row.endpoint as string,
      keys: typeof row.keys === 'string'
        ? JSON.parse(row.keys)
        : row.keys as PushKeys,
    };

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (err: unknown) {
      const statusCode = typeof err === 'object' && err && 'statusCode' in err
        ? (err as { statusCode?: number }).statusCode
        : undefined;

      // If the subscription is no longer active (410 Gone or 404 Not Found), clean it up from DB
      if (statusCode === 410 || statusCode === 404) {
        console.log(`Cleaning up expired subscription: ${row.endpoint}`);
        await deleteSubscription(row.endpoint);
      } else {
        console.error(`Error sending push notification:`, err);
      }
      failed += 1;
    }
  });

  await Promise.allSettled(notificationPromises);
  return { total: rows.length, sent, failed };
}
