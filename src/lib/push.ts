import webpush from 'web-push';
import { getPool, ensureMigrated } from './db';

const vapidEmail = 'mailto:admin@statoo.local';
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
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
  await ensureMigrated();
  const db = getPool();

  const { rows } = await db.query('SELECT endpoint, keys FROM push_subscriptions');
  if (rows.length === 0) return;

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

  const notificationPromises = rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: row.keys,
        },
        JSON.stringify(payload)
      );
    } catch (err: any) {
      // If the subscription is no longer active (410 Gone or 404 Not Found), clean it up from DB
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log(`Cleaning up expired subscription: ${row.endpoint}`);
        await deleteSubscription(row.endpoint);
      } else {
        console.error(`Error sending push notification:`, err);
      }
    }
  });

  await Promise.allSettled(notificationPromises);
}
