import { getPool, ensureMigrated } from './db';
import {
  Service, ServiceStatus, HealthCheckResult, UptimeDay,
  Incident, IncidentStatus, STATUS_SEVERITY,
} from './types';
import { checkHealth } from './health';

/* ── Services ────────────────────────────────── */

export async function getServices(): Promise<Service[]> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, description, url, status, sort_order, created_at, expected_status_code
     FROM services ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(mapService);
}

export async function getServiceById(id: number): Promise<Service | null> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, description, url, status, sort_order, created_at, expected_status_code
     FROM services WHERE id = $1`, [id]
  );
  return rows.length ? mapService(rows[0]) : null;
}

export async function createService(data: {
  name: string;
  description?: string;
  url?: string;
  expectedStatusCode?: number;
}): Promise<Service> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO services (name, description, url, expected_status_code)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.name, data.description ?? null, data.url ?? null, data.expectedStatusCode ?? 200]
  );
  return mapService(rows[0]);
}

export async function updateService(id: number, data: {
  name?: string;
  description?: string;
  url?: string;
  status?: ServiceStatus;
  sortOrder?: number;
  expectedStatusCode?: number;
}): Promise<Service | null> {
  await ensureMigrated();
  const db = getPool();

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }
  if (data.url !== undefined) { sets.push(`url = $${idx++}`); values.push(data.url); }
  if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
  if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); values.push(data.sortOrder); }
  if (data.expectedStatusCode !== undefined) { sets.push(`expected_status_code = $${idx++}`); values.push(data.expectedStatusCode); }

  if (sets.length === 0) return getServiceById(id);

  values.push(id);
  const { rows } = await db.query(
    `UPDATE services SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows.length ? mapService(rows[0]) : null;
}

export async function deleteService(id: number): Promise<boolean> {
  await ensureMigrated();
  const db = getPool();
  const { rowCount } = await db.query(`DELETE FROM services WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

function mapService(row: Record<string, unknown>): Service {
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | null,
    url: row.url as string | null,
    status: row.status as ServiceStatus,
    sortOrder: row.sort_order as number,
    createdAt: (row.created_at as Date).toISOString(),
    expectedStatusCode: (row.expected_status_code as number) ?? 200,
  };
}

/* ── Health Checks ───────────────────────────── */

export async function saveHealthCheck(serviceId: number, result: HealthCheckResult): Promise<void> {
  await ensureMigrated();
  const db = getPool();
  await db.query(
    `INSERT INTO health_checks (service_id, status, response_time, status_code, url, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [serviceId, result.status, result.responseTime, result.statusCode, result.url, result.checkedAt]
  );
}

export async function getUptimeDaysForService(serviceId: number, days: number = 90): Promise<UptimeDay[]> {
  await ensureMigrated();
  const db = getPool();

  const { rows } = await db.query(
    `SELECT
       DATE(checked_at AT TIME ZONE 'UTC') AS date,
       (ARRAY_AGG(status ORDER BY
         CASE status
           WHEN 'major_outage' THEN 1
           WHEN 'partial_outage' THEN 2
           WHEN 'degraded' THEN 3
           WHEN 'maintenance' THEN 4
           WHEN 'operational' THEN 5
           ELSE 6
         END
       ))[1] AS worst_status,
       AVG(response_time) FILTER (WHERE response_time IS NOT NULL) AS avg_response_time
     FROM health_checks
     WHERE service_id = $1 AND checked_at >= NOW() - make_interval(days => $2)
     GROUP BY DATE(checked_at AT TIME ZONE 'UTC')
     ORDER BY date ASC`,
    [serviceId, days]
  );

  const statusMap = new Map<string, { status: ServiceStatus; avgResponseTime: number | null }>();
  for (const row of rows) {
    const dateStr = row.date instanceof Date
      ? row.date.toISOString().split('T')[0]
      : String(row.date);
    statusMap.set(dateStr, {
      status: row.worst_status as ServiceStatus,
      avgResponseTime: row.avg_response_time ? Math.round(Number(row.avg_response_time)) : null
    });
  }

  const result: UptimeDay[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dayData = statusMap.get(dateStr);
    result.push({
      date: dateStr,
      status: dayData?.status || 'unknown',
      avgResponseTime: dayData?.avgResponseTime ?? null,
    });
  }
  return result;
}

/* ── Incidents ───────────────────────────────── */

export async function getIncidents(options?: {
  activeOnly?: boolean;
  serviceId?: number;
  limit?: number;
}): Promise<Incident[]> {
  await ensureMigrated();
  const db = getPool();

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (options?.activeOnly) {
    conditions.push(`i.status != 'resolved'`);
  }
  if (options?.serviceId) {
    conditions.push(`i.service_id = $${idx++}`);
    values.push(options.serviceId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ? `LIMIT $${idx++}` : '';
  if (options?.limit) values.push(options.limit);

  const { rows } = await db.query(
    `SELECT i.*, s.name AS service_name
     FROM incidents i
     JOIN services s ON s.id = i.service_id
     ${where}
     ORDER BY i.created_at DESC
     ${limit}`,
    values
  );

  return rows.map(mapIncident);
}

export async function createIncident(data: {
  serviceId: number;
  title: string;
  message: string;
  severity: ServiceStatus;
}): Promise<Incident> {
  await ensureMigrated();
  const db = getPool();

  const { rows } = await db.query(
    `INSERT INTO incidents (service_id, title, message, severity)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.serviceId, data.title, data.message, data.severity]
  );

  // Also update the service status to match severity
  await db.query(
    `UPDATE services SET status = $1 WHERE id = $2`,
    [data.severity, data.serviceId]
  );

  const incident = mapIncident(rows[0]);
  // Fetch service name
  const svc = await getServiceById(data.serviceId);
  incident.serviceName = svc?.name ?? undefined;
  return incident;
}

export async function updateIncident(id: number, data: {
  title?: string;
  message?: string;
  severity?: ServiceStatus;
  status?: IncidentStatus;
}): Promise<Incident | null> {
  await ensureMigrated();
  const db = getPool();

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.title !== undefined) { sets.push(`title = $${idx++}`); values.push(data.title); }
  if (data.message !== undefined) { sets.push(`message = $${idx++}`); values.push(data.message); }
  if (data.severity !== undefined) { sets.push(`severity = $${idx++}`); values.push(data.severity); }
  if (data.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(data.status);
    if (data.status === 'resolved') {
      sets.push(`resolved_at = NOW()`);
    }
  }

  if (sets.length === 0) return null;

  values.push(id);
  const { rows } = await db.query(
    `UPDATE incidents SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  if (rows.length === 0) return null;

  const incident = mapIncident(rows[0]);

  // If resolved, set service back to operational (if no other active incidents)
  if (data.status === 'resolved') {
    const serviceId = rows[0].service_id;
    const { rows: activeRows } = await db.query(
      `SELECT severity FROM incidents WHERE service_id = $1 AND status != 'resolved' ORDER BY
        CASE severity
          WHEN 'major_outage' THEN 1
          WHEN 'partial_outage' THEN 2
          WHEN 'degraded' THEN 3
          WHEN 'maintenance' THEN 4
          ELSE 5
        END
       LIMIT 1`,
      [serviceId]
    );
    const newStatus = activeRows.length > 0 ? activeRows[0].severity : 'operational';
    await db.query(`UPDATE services SET status = $1 WHERE id = $2`, [newStatus, serviceId]);
  }

  return incident;
}

export async function deleteIncident(id: number): Promise<boolean> {
  await ensureMigrated();
  const db = getPool();
  const { rowCount } = await db.query(`DELETE FROM incidents WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

function mapIncident(row: Record<string, unknown>): Incident {
  return {
    id: row.id as number,
    serviceId: row.service_id as number,
    serviceName: (row.service_name as string) ?? undefined,
    title: row.title as string,
    message: row.message as string,
    severity: row.severity as ServiceStatus,
    status: row.status as IncidentStatus,
    createdAt: (row.created_at as Date).toISOString(),
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
  };
}

/* ── Overall Status ──────────────────────────── */

export function deriveOverallStatus(services: Service[]): ServiceStatus {
  if (services.length === 0) return 'unknown';

  let worst: ServiceStatus = 'operational';
  for (const svc of services) {
    if (STATUS_SEVERITY[svc.status] < STATUS_SEVERITY[worst]) {
      worst = svc.status;
    }
  }
  return worst;
}

/* ── Service Statistics & Lazy Checking ──────────────────────────── */

export async function getLastHealthCheckTime(): Promise<Date | null> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT checked_at FROM health_checks ORDER BY checked_at DESC LIMIT 1`
  );
  return rows.length ? new Date(rows[0].checked_at) : null;
}

export async function runAllHealthChecks(): Promise<void> {
  await ensureMigrated();
  const services = await getServices();
  const activeIncidents = await getIncidents({ activeOnly: true });

  const promises = services.map(async (service) => {
    if (!service.url) return;

    try {
      const result = await checkHealth(service.url, service.expectedStatusCode);
      await saveHealthCheck(service.id, result);

      // Determine status: worst of active incidents and check status
      const serviceIncidents = activeIncidents.filter(i => i.serviceId === service.id);
      let newStatus = result.status;
      for (const incident of serviceIncidents) {
        if (STATUS_SEVERITY[incident.severity] < STATUS_SEVERITY[newStatus]) {
          newStatus = incident.severity;
        }
      }

      await updateService(service.id, { status: newStatus });
    } catch (err) {
      console.error(`Failed to run health check for service ${service.id}:`, err);
    }
  });

  await Promise.all(promises);
}

export async function ensureHealthChecksUpdated(): Promise<void> {
  const lastCheck = await getLastHealthCheckTime();
  const now = new Date();
  const shouldRun = !lastCheck || (now.getTime() - lastCheck.getTime() > 60_000);

  if (shouldRun) {
    await runAllHealthChecks();
  }
}

export async function getServicesWithStats(): Promise<Service[]> {
  const services = await getServices();
  const promises = services.map(async (service) => {
    if (!service.url) {
      return {
        ...service,
        avgLatency: null,
        uptimePercentage: 100.0,
        uptimeDays: [],
      };
    }

    const db = getPool();

    // 1. Avg latency (last 7 days)
    const latencyRes = await db.query(
      `SELECT AVG(response_time) as avg_latency
       FROM health_checks
       WHERE service_id = $1 AND response_time IS NOT NULL AND checked_at >= NOW() - INTERVAL '7 days'`,
      [service.id]
    );
    const avgLatency = latencyRes.rows[0]?.avg_latency
      ? Math.round(Number(latencyRes.rows[0].avg_latency))
      : null;

    // 2. Uptime percentage (last 30 days)
    const uptimeRes = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('operational', 'degraded', 'maintenance'))::float /
         NULLIF(COUNT(*), 0) * 100 as uptime_pct
       FROM health_checks
       WHERE service_id = $1 AND checked_at >= NOW() - INTERVAL '30 days'`,
      [service.id]
    );
    const uptimePercentage = uptimeRes.rows[0]?.uptime_pct !== null && uptimeRes.rows[0]?.uptime_pct !== undefined
      ? Number(Number(uptimeRes.rows[0].uptime_pct).toFixed(2))
      : 100.0;

    // 3. 90-day uptime history
    const uptimeDays = await getUptimeDaysForService(service.id, 90);

    return {
      ...service,
      avgLatency,
      uptimePercentage,
      uptimeDays,
    };
  });

  return Promise.all(promises);
}
