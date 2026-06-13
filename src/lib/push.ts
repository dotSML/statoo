import webpush from 'web-push';
import { getPool, ensureMigrated } from './db';

const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!process.env.VAPID_PUBLIC_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  console.warn(
    'VAPID_PUBLIC_KEY is not set; falling back to NEXT_PUBLIC_VAPID_PUBLIC_KEY. ' +
    'Set both and keep them identical to avoid JWT/signing mismatches.'
  );
}

if (vapidPublicKey && vapidPrivateKey && isValidVapidSubject(vapidSubject)) {
  webpush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey
  );
} else {
  if (!isValidVapidSubject(vapidSubject)) {
    console.warn(
      `VAPID_SUBJECT "${vapidSubject}" is invalid. Use a "mailto:" or "https://" URI. ` +
      'Push notifications will not be sent.'
    );
  } else {
    console.warn('VAPID keys are missing from environment. Push notifications will not be sent.');
  }
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

interface PushDeleteStats {
  deleted: number;
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
 * Remove all push subscriptions from the database.
 */
export async function deleteAllSubscriptions(): Promise<PushDeleteStats> {
  await ensureMigrated();
  const db = getPool();
  const result = await db.query('DELETE FROM push_subscriptions');
  return { deleted: result.rowCount ?? 0 };
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
      const endpoint = typeof err === 'object' && err && 'endpoint' in err
        ? String((err as { endpoint?: string }).endpoint)
        : '';
      const body = typeof err === 'object' && err && 'body' in err
        ? String((err as { body?: string }).body)
        : '';
      const badJwtFromApple = statusCode === 403
        && endpoint.includes('web.push.apple.com')
        && body.includes('BadJwtToken');

      // If the subscription is no longer active (410 Gone or 404 Not Found), clean it up from DB
      if (statusCode === 410 || statusCode === 404) {
        console.log(`Cleaning up expired subscription: ${row.endpoint}`);
        await deleteSubscription(row.endpoint);
      } else if (badJwtFromApple) {
        console.error(
          'Apple rejected the VAPID JWT (BadJwtToken). ' +
          'Check that VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are from the same pair, ' +
          'VAPID_SUBJECT is valid (mailto: or https://), and iOS devices re-subscribe after key changes.',
          err
        );
      } else {
        console.error(`Error sending push notification:`, err);
      }
      failed += 1;
    }
  });

  await Promise.allSettled(notificationPromises);
  return { total: rows.length, sent, failed };
}

function isValidVapidSubject(subject: string): boolean {
  if (subject.startsWith('mailto:')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject.slice('mailto:'.length));
  }

  if (subject.startsWith('https://')) {
    try {
      const url = new URL(subject);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  return false;
}
