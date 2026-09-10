import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool } from '../db';
import type { ServiceStatus } from '../types';

// Persist both scheduling and alert state: memory alone cannot coordinate
// concurrent requests or separate Vercel instances.
const CHECK_INTERVAL_SECONDS = 60;
const LEASE_SECONDS = 90;
const CONFIRMATION_MAX_GAP_SECONDS = 5 * 60;
const FAILURE_THRESHOLD = 3;
const RECOVERY_THRESHOLD = 2;

export interface HealthCheckLease {
  token: string;
  failures: number;
  successes: number;
  outageActive: boolean;
}

export async function claimHealthCheck(serviceId: number): Promise<HealthCheckLease | null> {
  await ensureMigrated();
  const token = randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO health_alert_state (service_id, lease_token, lease_until, outage_active)
     SELECT id, $2, NOW() + make_interval(secs => $3),
            status IN ('major_outage', 'partial_outage')
     FROM services WHERE id = $1
     ON CONFLICT (service_id) DO UPDATE
     SET lease_token = EXCLUDED.lease_token,
         lease_until = EXCLUDED.lease_until,
         failures = CASE WHEN health_alert_state.checked_at >= NOW() - make_interval(secs => $5)
                    THEN health_alert_state.failures ELSE 0 END,
         successes = CASE WHEN health_alert_state.checked_at >= NOW() - make_interval(secs => $5)
                     THEN health_alert_state.successes ELSE 0 END
     WHERE (health_alert_state.lease_until IS NULL OR health_alert_state.lease_until <= NOW())
       AND (health_alert_state.checked_at IS NULL
            OR health_alert_state.checked_at <= NOW() - make_interval(secs => $4))
     RETURNING failures, successes, outage_active`,
    [serviceId, token, LEASE_SECONDS, CHECK_INTERVAL_SECONDS, CONFIRMATION_MAX_GAP_SECONDS]
  );
  if (!rows.length) return null;
  return {
    token,
    failures: rows[0].failures,
    successes: rows[0].successes,
    outageActive: rows[0].outage_active,
  };
}

// The token is a fencing token: expired/replaced workers cannot advance state
// or claim an alert. Persist the claim BEFORE sending push, favoring no duplicate
// alerts over retries if a process dies during delivery.
export async function completeHealthCheck(
  serviceId: number,
  lease: HealthCheckLease,
  status: ServiceStatus
): Promise<boolean> {
  const failed = status === 'major_outage' || status === 'partial_outage';
  const succeeded = status === 'operational' || status === 'degraded';
  const failures = failed ? Math.min(lease.failures + 1, FAILURE_THRESHOLD) : 0;
  const successes = succeeded ? Math.min(lease.successes + 1, RECOVERY_THRESHOLD) : 0;
  const notify = failed && failures >= FAILURE_THRESHOLD && !lease.outageActive;
  const outageActive = notify || (lease.outageActive && successes < RECOVERY_THRESHOLD);

  const { rowCount } = await getPool().query(
    `UPDATE health_alert_state
     SET failures = $3, successes = $4, outage_active = $5,
         checked_at = NOW(), lease_token = NULL, lease_until = NULL
     WHERE service_id = $1 AND lease_token = $2 AND lease_until > NOW()`,
    [serviceId, lease.token, failures, successes, outageActive]
  );
  return rowCount === 1 && notify;
}

export async function releaseHealthCheck(serviceId: number, token: string): Promise<void> {
  await getPool().query(
    `UPDATE health_alert_state SET lease_token = NULL, lease_until = NULL
     WHERE service_id = $1 AND lease_token = $2`,
    [serviceId, token]
  );
}
