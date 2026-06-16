import { ensureMigrated, getPool } from '../db';
import { checkServiceHealth } from '../health';
import type {
  HealthCheckResult,
  Incident,
  Service,
  ServiceStatus,
  UptimeDay,
} from '../types';
import { STATUS_SEVERITY } from '../types';
import { getIncidents } from './incidents';
import {
  getCachedServices,
  getCachedServicesForHealthChecks,
  getServices,
  getServicesForHealthChecks as loadServicesForHealthChecks,
  updateService,
} from './services';
import type { ServiceForHealthCheck } from './services';

const UPTIME_DAYS = 90;
const HEALTH_CHECK_STALE_MS = 60_000;
const DEFAULT_HEALTH_CHECK_BUFFER_LIMIT = 5000;

interface BufferedHealthCheck {
  serviceId: number;
  result: HealthCheckResult;
  queuedAt: string;
}

interface HealthCheckBufferState {
  items: BufferedHealthCheck[];
  flushPromise: Promise<void> | null;
}

interface ServiceStats {
  avgLatency: number | null;
  uptimePercentage: number;
}

export async function saveHealthCheck(
  serviceId: number,
  result: HealthCheckResult
): Promise<void> {
  await tryFlushBufferedHealthChecks();

  try {
    await insertHealthCheck(serviceId, result);
  } catch (error) {
    if (!shouldBufferHealthCheckWriteError(error)) {
      throw error;
    }

    bufferHealthCheck(serviceId, result, error);
  }
}

async function insertHealthCheck(
  serviceId: number,
  result: HealthCheckResult
): Promise<void> {
  await ensureMigrated();
  await getPool().query(
    `INSERT INTO health_checks
       (service_id, status, response_time, status_code, url, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      serviceId,
      result.status,
      result.responseTime,
      result.statusCode,
      result.url,
      result.checkedAt,
    ]
  );
}

export async function getUptimeDaysForService(
  serviceId: number,
  days = UPTIME_DAYS
): Promise<UptimeDay[]> {
  const daysByService = await getUptimeDaysByService([serviceId], days);
  return daysByService.get(serviceId) ?? createEmptyUptimeDays(days);
}

export async function getLastHealthCheckTime(): Promise<Date | null> {
  await tryFlushBufferedHealthChecks();
  await ensureMigrated();
  const { rows } = await getPool().query(
    'SELECT checked_at FROM health_checks ORDER BY checked_at DESC LIMIT 1'
  );
  return rows.length > 0 ? new Date(rows[0].checked_at) : null;
}

export async function runAllHealthChecks(): Promise<void> {
  const services = await getHealthCheckServices();
  const activeIncidents = await getActiveIncidentsForHealthChecks();

  const incidentsByService = new Map<number, ServiceStatus[]>();
  for (const incident of activeIncidents) {
    const statuses = incidentsByService.get(incident.serviceId) ?? [];
    statuses.push(incident.severity);
    incidentsByService.set(incident.serviceId, statuses);
  }

  await Promise.all(
    services.map(async (service) => {
      if (!service.url) {
        return;
      }

      try {
        const result = await checkServiceHealth(service);
        await saveHealthCheck(service.id, result);

        const nextStatus = findWorstStatus([
          result.status,
          ...(incidentsByService.get(service.id) ?? []),
        ]);

        try {
          await updateService(service.id, { status: nextStatus });
        } catch (error) {
          console.error(
            `Failed to update status for service ${service.id}:`,
            error
          );
          return;
        }

        if (
          service.status === 'operational'
          && isOutageStatus(nextStatus)
        ) {
          await notifyOutageSafely(service.name, nextStatus);
        }
      } catch (error) {
        console.error(
          `Failed to run health check for service ${service.id}:`,
          error
        );
      }
    })
  );
}

export async function ensureHealthChecksUpdated(): Promise<void> {
  let lastCheck: Date | null;

  try {
    lastCheck = await getLastHealthCheckTime();
  } catch (error) {
    lastCheck = getNewestBufferedHealthCheckTime();
    console.warn(
      'Failed to read latest persisted health check time; ' +
        'using buffered health checks if available.',
      error
    );
  }

  const isStale =
    !lastCheck || Date.now() - lastCheck.getTime() > HEALTH_CHECK_STALE_MS;

  if (isStale) {
    try {
      await runAllHealthChecks();
    } catch (error) {
      console.warn('Unable to update health checks right now.', error);
    }
  }
}

export async function getServicesWithStats(): Promise<Service[]> {
  let services: Service[];

  try {
    services = await getServices();
  } catch (error) {
    const cachedServices = getCachedServices();
    if (cachedServices.length === 0) {
      console.warn(
        'Failed to load services from the database and no cached services are available.',
        error
      );
      return [];
    }

    console.warn(
      'Failed to load services from the database; showing cached services.',
      error
    );
    return cachedServices.map(withoutMonitoringStats);
  }

  const monitoredServices = services.filter((service) => service.url);

  if (monitoredServices.length === 0) {
    return services.map(withoutMonitoringStats);
  }

  const serviceIds = monitoredServices.map((service) => service.id);
  let statsByService: Map<number, ServiceStats>;
  let uptimeByService: Map<number, UptimeDay[]>;

  try {
    [statsByService, uptimeByService] = await Promise.all([
      getStatsByService(serviceIds),
      getUptimeDaysByService(serviceIds, UPTIME_DAYS),
    ]);
  } catch (error) {
    console.warn(
      'Failed to load service stats from the database; showing services without uptime stats.',
      error
    );
    return services.map(withoutMonitoringStats);
  }

  return services.map((service) => {
    if (!service.url) {
      return withoutMonitoringStats(service);
    }

    const stats = statsByService.get(service.id) ?? {
      avgLatency: null,
      uptimePercentage: 100,
    };
    return {
      ...service,
      ...stats,
      uptimeDays:
        uptimeByService.get(service.id) ?? createEmptyUptimeDays(UPTIME_DAYS),
    };
  });
}

async function getHealthCheckServices(): Promise<ServiceForHealthCheck[]> {
  try {
    return await loadServicesForHealthChecks();
  } catch (error) {
    const cachedServices = getCachedServicesForHealthChecks();
    if (cachedServices.length === 0) {
      throw error;
    }

    console.warn(
      'Failed to load services from the database; ' +
        `checking ${cachedServices.length} cached service definition(s).`,
      error
    );
    return cachedServices;
  }
}

async function getActiveIncidentsForHealthChecks(): Promise<Incident[]> {
  try {
    return await getIncidents({ activeOnly: true });
  } catch (error) {
    console.warn(
      'Failed to load active incidents from the database; ' +
        'continuing automated checks without incident overrides.',
      error
    );
    return [];
  }
}

async function tryFlushBufferedHealthChecks(): Promise<void> {
  const state = getHealthCheckBufferState();
  if (state.items.length === 0) {
    return;
  }

  try {
    await flushBufferedHealthChecks();
  } catch (error) {
    console.warn(
      `Unable to flush ${state.items.length} buffered health check(s) yet.`,
      error
    );
  }
}

async function flushBufferedHealthChecks(): Promise<void> {
  const state = getHealthCheckBufferState();
  if (state.items.length === 0) {
    return;
  }

  if (state.flushPromise) {
    return state.flushPromise;
  }

  state.flushPromise = (async () => {
    while (state.items.length > 0) {
      const item = state.items[0];

      try {
        await insertHealthCheck(item.serviceId, item.result);
        state.items.shift();
      } catch (error) {
        if (shouldDropBufferedHealthCheck(error)) {
          state.items.shift();
          console.error(
            `Dropping buffered health check for missing service ${item.serviceId}.`,
            error
          );
          continue;
        }

        throw error;
      }
    }
  })().finally(() => {
    state.flushPromise = null;
  });

  return state.flushPromise;
}

function bufferHealthCheck(
  serviceId: number,
  result: HealthCheckResult,
  error: unknown
): void {
  const state = getHealthCheckBufferState();
  state.items.push({
    serviceId,
    result: { ...result },
    queuedAt: new Date().toISOString(),
  });

  const overflow = state.items.length - getHealthCheckBufferLimit();
  if (overflow > 0) {
    state.items.splice(0, overflow);
    console.warn(
      `Dropped ${overflow} buffered health check(s) because the in-memory ` +
        'buffer limit was reached.'
    );
  }

  console.warn(
    `Buffered health check for service ${serviceId}; ` +
      `${state.items.length} pending write(s).`,
    error
  );
}

function getNewestBufferedHealthCheckTime(): Date | null {
  const state = getHealthCheckBufferState();
  let newest: Date | null = null;

  for (const item of state.items) {
    const checkedAt = new Date(item.result.checkedAt);
    if (Number.isNaN(checkedAt.getTime())) {
      continue;
    }

    if (!newest || checkedAt > newest) {
      newest = checkedAt;
    }
  }

  return newest;
}

function getHealthCheckBufferState(): HealthCheckBufferState {
  const globalState = globalThis as typeof globalThis & {
    __statooHealthCheckBuffer?: HealthCheckBufferState;
  };

  if (!globalState.__statooHealthCheckBuffer) {
    globalState.__statooHealthCheckBuffer = {
      items: [],
      flushPromise: null,
    };
  }

  return globalState.__statooHealthCheckBuffer;
}

function getHealthCheckBufferLimit(): number {
  const configuredLimit = Number(process.env.HEALTH_CHECK_BUFFER_LIMIT);
  return Number.isInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : DEFAULT_HEALTH_CHECK_BUFFER_LIMIT;
}

function shouldBufferHealthCheckWriteError(error: unknown): boolean {
  return !isDatabaseConfigError(error) && !shouldDropBufferedHealthCheck(error);
}

function shouldDropBufferedHealthCheck(error: unknown): boolean {
  return getPostgresErrorCode(error) === '23503';
}

function getPostgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isDatabaseConfigError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('DATABASE_URL environment variable is not set');
}

async function getStatsByService(
  serviceIds: number[]
): Promise<Map<number, ServiceStats>> {
  const { rows } = await getPool().query(
    `SELECT
       service_id,
       AVG(response_time) FILTER (
         WHERE response_time IS NOT NULL
           AND checked_at >= NOW() - INTERVAL '7 days'
       ) AS avg_latency,
       COUNT(*) FILTER (
         WHERE status IN ('operational', 'degraded', 'maintenance')
           AND checked_at >= NOW() - INTERVAL '30 days'
       )::float / NULLIF(
         COUNT(*) FILTER (
           WHERE checked_at >= NOW() - INTERVAL '30 days'
         ),
         0
       ) * 100 AS uptime_pct
     FROM health_checks
     WHERE service_id = ANY($1::int[])
       AND checked_at >= NOW() - INTERVAL '30 days'
     GROUP BY service_id`,
    [serviceIds]
  );

  return new Map(
    rows.map((row) => [
      row.service_id as number,
      {
        avgLatency: row.avg_latency
          ? Math.round(Number(row.avg_latency))
          : null,
        uptimePercentage: row.uptime_pct == null
          ? 100
          : Number(Number(row.uptime_pct).toFixed(2)),
      },
    ])
  );
}

async function getUptimeDaysByService(
  serviceIds: number[],
  days: number
): Promise<Map<number, UptimeDay[]>> {
  await ensureMigrated();
  if (serviceIds.length === 0) {
    return new Map();
  }

  const { rows } = await getPool().query(
    `SELECT
       service_id,
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
       AVG(response_time) FILTER (
         WHERE response_time IS NOT NULL
       ) AS avg_response_time
     FROM health_checks
     WHERE service_id = ANY($1::int[])
       AND checked_at >= NOW() - make_interval(days => $2)
     GROUP BY service_id, DATE(checked_at AT TIME ZONE 'UTC')
     ORDER BY service_id, date ASC`,
    [serviceIds, days]
  );

  const recordedDays = new Map<
    number,
    Map<string, { status: ServiceStatus; avgResponseTime: number | null }>
  >();
  for (const row of rows) {
    const serviceId = row.service_id as number;
    const serviceDays = recordedDays.get(serviceId) ?? new Map();
    serviceDays.set(formatDatabaseDate(row.date), {
      status: row.worst_status as ServiceStatus,
      avgResponseTime: row.avg_response_time
        ? Math.round(Number(row.avg_response_time))
        : null,
    });
    recordedDays.set(serviceId, serviceDays);
  }

  return new Map(
    serviceIds.map((serviceId) => [
      serviceId,
      createUptimeDays(days, recordedDays.get(serviceId)),
    ])
  );
}

function createUptimeDays(
  days: number,
  recordedDays = new Map<
    string,
    { status: ServiceStatus; avgResponseTime: number | null }
  >()
): UptimeDay[] {
  const result: UptimeDay[] = [];
  const now = new Date();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - offset);
    const dateString = date.toISOString().slice(0, 10);
    const recorded = recordedDays.get(dateString);
    result.push({
      date: dateString,
      status: recorded?.status ?? 'unknown',
      avgResponseTime: recorded?.avgResponseTime ?? null,
    });
  }

  return result;
}

function createEmptyUptimeDays(days: number): UptimeDay[] {
  return createUptimeDays(days);
}

function formatDatabaseDate(value: unknown): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value);
}

function withoutMonitoringStats(service: Service): Service {
  return {
    ...service,
    avgLatency: null,
    uptimePercentage: 100,
    uptimeDays: [],
  };
}

function findWorstStatus(statuses: ServiceStatus[]): ServiceStatus {
  return statuses.reduce((worst, status) =>
    STATUS_SEVERITY[status] < STATUS_SEVERITY[worst] ? status : worst
  );
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
  status: ServiceStatus
): Promise<void> {
  try {
    const { notifyOutage } = await import('../push');
    await notifyOutage(serviceName, status);
  } catch (error) {
    console.error(
      `Failed to send push notification for automated check on ${serviceName}:`,
      error
    );
  }
}
