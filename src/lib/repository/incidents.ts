import { ensureMigrated, getPool } from '../db';
import type { Incident, IncidentStatus, ServiceStatus } from '../types';
import { STATUS_SEVERITY } from '../types';
import { getServiceById, updateCachedServiceStatus } from './services';

export interface GetIncidentsOptions {
  activeOnly?: boolean;
  serviceId?: number;
  limit?: number;
}

export interface CreateIncidentInput {
  serviceId: number;
  title: string;
  message: string;
  severity: ServiceStatus;
}

export interface UpdateIncidentInput {
  title?: string;
  message?: string;
  severity?: ServiceStatus;
  status?: IncidentStatus;
}

interface IncidentCacheState {
  incidents: Incident[] | null;
}

function getIncidentCacheState(): IncidentCacheState {
  const globalState = globalThis as typeof globalThis & {
    __statooIncidentCache?: IncidentCacheState;
  };

  if (!globalState.__statooIncidentCache) {
    globalState.__statooIncidentCache = {
      incidents: null,
    };
  }

  return globalState.__statooIncidentCache;
}

export async function getIncidents(
  options: GetIncidentsOptions = {}
): Promise<Incident[]> {
  try {
    await ensureMigrated();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.activeOnly) {
      conditions.push("i.status != 'resolved'");
    }
    if (options.serviceId !== undefined) {
      values.push(options.serviceId);
      conditions.push(`i.service_id = $${values.length}`);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';
    let limit = '';
    if (options.limit !== undefined) {
      values.push(options.limit);
      limit = `LIMIT $${values.length}`;
    }

    const { rows } = await getPool().query(
      `SELECT i.*, s.name AS service_name
       FROM incidents i
       JOIN services s ON s.id = i.service_id
       ${where}
       ORDER BY i.created_at DESC
       ${limit}`,
      values
    );

    const incidents = rows.map(mapIncident);
    rememberIncidents(incidents);
    return incidents;
  } catch (error) {
    const cachedIncidents = getCachedIncidents(options);
    if (cachedIncidents.length > 0) {
      console.warn(
        'Failed to load incidents from the database; showing cached incidents.',
        error
      );
      return cachedIncidents;
    }

    throw error;
  }
}

export async function createIncident(
  data: CreateIncidentInput
): Promise<Incident> {
  await ensureMigrated();
  const db = getPool();
  const service = await getServiceById(data.serviceId);

  const { rows } = await db.query(
    `INSERT INTO incidents (service_id, title, message, severity)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.serviceId, data.title, data.message, data.severity]
  );

  await reconcileServiceStatus(data.serviceId);

  const incident = mapIncident(rows[0]);
  incident.serviceName = service?.name;
  rememberIncident(incident);

  if (
    service?.status === 'operational'
    && isOutageStatus(data.severity)
  ) {
    await notifyOutageSafely(service.name, data.severity, 'manual incident');
  }

  return incident;
}

export async function updateIncident(
  id: number,
  data: UpdateIncidentInput
): Promise<Incident | null> {
  await ensureMigrated();

  const fields: Array<[column: string, value: unknown]> = [];
  if (data.title !== undefined) fields.push(['title', data.title]);
  if (data.message !== undefined) fields.push(['message', data.message]);
  if (data.severity !== undefined) fields.push(['severity', data.severity]);
  if (data.status !== undefined) {
    fields.push(['status', data.status]);
  }

  if (fields.length === 0) {
    return null;
  }

  const values = fields.map(([, value]) => value);
  const assignments = fields.map(
    ([column], index) => `${column} = $${index + 1}`
  );

  if (data.status === 'resolved') {
    assignments.push('resolved_at = NOW()');
  } else if (data.status !== undefined) {
    assignments.push('resolved_at = NULL');
  }

  values.push(id);
  const { rows } = await getPool().query(
    `UPDATE incidents
     SET ${assignments.join(', ')}
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  if (rows.length === 0) {
    return null;
  }

  if (data.status !== undefined || data.severity !== undefined) {
    await reconcileServiceStatus(rows[0].service_id as number);
  }

  const incident = mapIncident(rows[0]);
  rememberIncident(incident);
  return incident;
}

export async function deleteIncident(id: number): Promise<boolean> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    'DELETE FROM incidents WHERE id = $1 RETURNING service_id',
    [id]
  );

  if (rows.length === 0) {
    return false;
  }

  await reconcileServiceStatus(rows[0].service_id as number);
  forgetIncident(id);
  return true;
}

async function reconcileServiceStatus(serviceId: number): Promise<void> {
  const db = getPool();
  const [incidentResult, healthResult] = await Promise.all([
    db.query(
      `SELECT severity
       FROM incidents
       WHERE service_id = $1 AND status != 'resolved'`,
      [serviceId]
    ),
    db.query(
      `SELECT status
       FROM health_checks
       WHERE service_id = $1
       ORDER BY checked_at DESC
       LIMIT 1`,
      [serviceId]
    ),
  ]);

  const statuses = incidentResult.rows.map(
    (row) => row.severity as ServiceStatus
  );
  if (healthResult.rows[0]?.status) {
    statuses.push(healthResult.rows[0].status as ServiceStatus);
  }

  const nextStatus = statuses.length === 0
    ? 'operational'
    : statuses.reduce((worst, status) =>
        STATUS_SEVERITY[status] < STATUS_SEVERITY[worst] ? status : worst
      );

  await db.query(
    'UPDATE services SET status = $1 WHERE id = $2',
    [nextStatus, serviceId]
  );
  updateCachedServiceStatus(serviceId, nextStatus);
}

function getCachedIncidents(options: GetIncidentsOptions): Incident[] {
  const incidents = getIncidentCacheState().incidents;
  if (!incidents) {
    return [];
  }

  let result = incidents.map(cloneIncident);
  if (options.activeOnly) {
    result = result.filter((incident) => incident.status !== 'resolved');
  }
  if (options.serviceId !== undefined) {
    result = result.filter((incident) => incident.serviceId === options.serviceId);
  }
  result.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return options.limit === undefined ? result : result.slice(0, options.limit);
}

function rememberIncidents(incidents: Incident[]): void {
  const state = getIncidentCacheState();
  const existingById = new Map(
    (state.incidents ?? []).map((incident) => [incident.id, incident])
  );

  for (const incident of incidents) {
    const existing = existingById.get(incident.id);
    existingById.set(incident.id, {
      ...cloneIncident(incident),
      serviceName: incident.serviceName ?? existing?.serviceName,
    });
  }

  state.incidents = Array.from(existingById.values()).sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function rememberIncident(incident: Incident): void {
  rememberIncidents([incident]);
}

function forgetIncident(id: number): void {
  const state = getIncidentCacheState();
  if (!state.incidents) {
    return;
  }

  state.incidents = state.incidents.filter((incident) => incident.id !== id);
}

function cloneIncident(incident: Incident): Incident {
  return { ...incident };
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
    resolvedAt: row.resolved_at
      ? (row.resolved_at as Date).toISOString()
      : null,
  };
}

function isOutageStatus(status: ServiceStatus): boolean {
  return (
    status === 'major_outage'
    || status === 'partial_outage'
    || status === 'degraded'
  );
}

async function notifyOutageSafely(
  serviceName: string,
  status: ServiceStatus,
  source: string
): Promise<void> {
  try {
    const { notifyOutage } = await import('../push');
    await notifyOutage(serviceName, status);
  } catch (error) {
    console.error(
      `Failed to send push notification for ${source} on ${serviceName}:`,
      error
    );
  }
}
