import { getPool, ensureMigrated } from './db';
import {
  Service, ServiceStatus, HealthCheckResult, UptimeDay,
  Incident, IncidentStatus, STATUS_SEVERITY,
} from './types';

/* ── Services ────────────────────────────────── */

export async function getServices(): Promise<Service[]> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, description, url, status, sort_order, created_at
     FROM services ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(mapService);
}

export async function getServiceById(id: number): Promise<Service | null> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `SELECT id, name, description, url, status, sort_order, created_at
     FROM services WHERE id = $1`, [id]
  );
  return rows.length ? mapService(rows[0]) : null;
}

export async function createService(data: {
  name: string;
  description?: string;
  url?: string;
}): Promise<Service> {
  await ensureMigrated();
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO services (name, description, url)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.name, data.description ?? null, data.url ?? null]
  );
  return mapService(rows[0]);
}

export async function updateService(id: number, data: {
  name?: string;
  description?: string;
  url?: string;
  status?: ServiceStatus;
  sortOrder?: number;
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
       ))[1] AS worst_status
     FROM health_checks
     WHERE service_id = $1 AND checked_at >= NOW() - make_interval(days => $2)
     GROUP BY DATE(checked_at AT TIME ZONE 'UTC')
     ORDER BY date ASC`,
    [serviceId, days]
  );

  const statusMap = new Map<string, ServiceStatus>();
  for (const row of rows) {
    const dateStr = row.date instanceof Date
      ? row.date.toISOString().split('T')[0]
      : String(row.date);
    statusMap.set(dateStr, row.worst_status as ServiceStatus);
  }

  const result: UptimeDay[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    result.push({
      date: dateStr,
      status: statusMap.get(dateStr) || 'unknown',
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
