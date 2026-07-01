import { ensureMigrated, getPool } from '../db';
import type { Service, ServiceCheckType, ServiceStatus } from '../types';

export interface CreateServiceInput {
  name: string;
  description?: string | null;
  url?: string | null;
  checkType?: ServiceCheckType;
  expectedStatusCode?: number;
  status?: ServiceStatus;
  jellyfinUsername?: string | null;
  jellyfinPassword?: string | null;
  jellyfinMediaUrl?: string | null;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  url?: string | null;
  checkType?: ServiceCheckType;
  status?: ServiceStatus;
  sortOrder?: number;
  expectedStatusCode?: number;
  jellyfinUsername?: string | null;
  jellyfinPassword?: string | null;
  jellyfinMediaUrl?: string | null;
}

export interface ServiceForHealthCheck extends Service {
  jellyfinPassword: string | null;
}

const PUBLIC_SERVICE_COLUMNS =
  'id, name, description, url, check_type, status, sort_order, created_at, expected_status_code';
const ADMIN_SERVICE_COLUMNS =
  `${PUBLIC_SERVICE_COLUMNS}, jellyfin_username, jellyfin_media_url, ` +
  "(jellyfin_password IS NOT NULL AND jellyfin_password != '') AS has_jellyfin_password";
const HEALTH_CHECK_SERVICE_COLUMNS =
  `${PUBLIC_SERVICE_COLUMNS}, jellyfin_username, jellyfin_password, jellyfin_media_url`;

interface ServiceCacheState {
  services: ServiceForHealthCheck[] | null;
  bufferedUpdates: BufferedServiceUpdate[];
  flushPromise: Promise<void> | null;
}

interface BufferedServiceUpdate {
  id: number;
  data: UpdateServiceInput;
  queuedAt: string;
}

const DEFAULT_SERVICE_UPDATE_BUFFER_LIMIT = 1000;

function getServiceCacheState(): ServiceCacheState {
  const globalState = globalThis as typeof globalThis & {
    __statooServiceCache?: ServiceCacheState;
  };

  if (!globalState.__statooServiceCache) {
    globalState.__statooServiceCache = {
      services: null,
      bufferedUpdates: [],
      flushPromise: null,
    };
  }

  return globalState.__statooServiceCache;
}

export function getCachedServices(): Service[] {
  const services = getServiceCacheState().services;
  return services ? services.map(toPublicService) : [];
}

export function getCachedAdminServices(): Service[] {
  const services = getServiceCacheState().services;
  return services ? services.map(toAdminService) : [];
}

export async function getServices(): Promise<Service[]> {
  try {
    await tryFlushBufferedServiceUpdates();
    await ensureMigrated();
    const { rows } = await getPool().query(
      `SELECT ${PUBLIC_SERVICE_COLUMNS}
       FROM services
       ORDER BY sort_order ASC, id ASC`
    );
    const services = rows.map(mapService);
    rememberPublicServices(services);
    return services;
  } catch (error) {
    const cachedServices = getCachedServices();
    if (cachedServices.length > 0) {
      console.warn(
        'Failed to load services from the database; showing cached services.',
        error
      );
      return cachedServices;
    }

    throw error;
  }
}

export async function getAdminServices(): Promise<Service[]> {
  try {
    await tryFlushBufferedServiceUpdates();
    await ensureMigrated();
    const { rows } = await getPool().query(
      `SELECT ${ADMIN_SERVICE_COLUMNS}
       FROM services
       ORDER BY sort_order ASC, id ASC`
    );
    const services = rows.map(mapAdminService);
    rememberPublicServices(services);
    return services;
  } catch (error) {
    const cachedServices = getCachedAdminServices();
    if (cachedServices.length > 0) {
      console.warn(
        'Failed to load admin services from the database; ' +
          'showing cached services.',
        error
      );
      return cachedServices;
    }

    throw error;
  }
}

export async function getServicesForHealthChecks(): Promise<ServiceForHealthCheck[]> {
  try {
    await tryFlushBufferedServiceUpdates();
    await ensureMigrated();
    const { rows } = await getPool().query(
      `SELECT ${HEALTH_CHECK_SERVICE_COLUMNS}
       FROM services
       ORDER BY sort_order ASC, id ASC`
    );
    const services = rows.map(mapHealthCheckService);
    rememberServices(services);
    return services;
  } catch (error) {
    const cachedServices = getCachedServicesForHealthChecks();
    if (cachedServices.length > 0) {
      console.warn(
        'Failed to load health-check services from the database; ' +
          'using cached service definitions.',
        error
      );
      return cachedServices;
    }

    throw error;
  }
}

export function getCachedServicesForHealthChecks(): ServiceForHealthCheck[] {
  const services = getServiceCacheState().services;
  return services ? services.map(cloneHealthCheckService) : [];
}

export async function getServiceById(id: number): Promise<Service | null> {
  try {
    await tryFlushBufferedServiceUpdates();
    await ensureMigrated();
    const { rows } = await getPool().query(
      `SELECT ${PUBLIC_SERVICE_COLUMNS}
       FROM services
       WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return null;
    }

    const service = mapService(rows[0]);
    rememberPublicService(service);
    return service;
  } catch (error) {
    const cachedService = getCachedServiceById(id);
    if (cachedService) {
      console.warn(
        `Failed to load service ${id} from the database; ` +
          'showing cached service.',
        error
      );
      return toPublicService(cachedService);
    }

    throw error;
  }
}

export async function createService(data: CreateServiceInput): Promise<Service> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `INSERT INTO services
       (
         name,
         description,
         url,
         check_type,
         expected_status_code,
         status,
         jellyfin_username,
         jellyfin_password,
         jellyfin_media_url
       )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      data.url ?? null,
      data.checkType ?? 'http',
      data.expectedStatusCode ?? 200,
      data.status ?? 'operational',
      data.jellyfinUsername ?? null,
      data.jellyfinPassword ?? null,
      data.jellyfinMediaUrl ?? null,
    ]
  );
  const service = mapHealthCheckService(rows[0]);
  rememberService(service);
  return toAdminService(service);
}

export async function updateService(
  id: number,
  data: UpdateServiceInput
): Promise<Service | null> {
  await tryFlushBufferedServiceUpdates();

  const fields = buildUpdateFields(data);

  if (fields.length === 0) {
    return getServiceById(id);
  }

  try {
    const service = await updateServiceInDatabase(id, fields);
    if (!service) {
      return null;
    }

    rememberService(service);
    return toAdminService(service);
  } catch (error) {
    if (!shouldBufferServiceUpdateError(error)) {
      throw error;
    }

    const cachedService = updateCachedService(id, data);
    if (!cachedService) {
      throw error;
    }

    bufferServiceUpdate(id, data, error);
    return toAdminService(cachedService);
  }
}

export async function deleteService(id: number): Promise<boolean> {
  await ensureMigrated();
  const { rowCount } = await getPool().query(
    'DELETE FROM services WHERE id = $1',
    [id]
  );
  const deleted = (rowCount ?? 0) > 0;
  if (deleted) {
    forgetService(id);
  }
  return deleted;
}

export function rememberPublicServices(services: Service[]): void {
  replaceCachedServices(services.map(toCachedService));
}

export function rememberPublicService(service: Service): void {
  rememberService(toCachedService(service));
}

export function updateCachedServiceStatus(
  id: number,
  status: ServiceStatus
): Service | null {
  const service = updateCachedService(id, { status });
  return service ? toPublicService(service) : null;
}

export async function tryFlushBufferedServiceUpdates(): Promise<void> {
  const state = getServiceCacheState();
  if (state.bufferedUpdates.length === 0) {
    return;
  }

  try {
    await flushBufferedServiceUpdates();
  } catch (error) {
    console.warn(
      `Unable to flush ${state.bufferedUpdates.length} buffered ` +
        'service update(s) yet.',
      error
    );
  }
}

async function updateServiceInDatabase(
  id: number,
  fields: Array<[column: string, value: unknown]>
): Promise<ServiceForHealthCheck | null> {
  await ensureMigrated();

  const values = fields.map(([, value]) => value);
  const assignments = fields.map(
    ([column], index) => `${column} = $${index + 1}`
  );
  values.push(id);

  const { rows } = await getPool().query(
    `UPDATE services
     SET ${assignments.join(', ')}
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  return rows.length === 0 ? null : mapHealthCheckService(rows[0]);
}

function mapService(row: Record<string, unknown>): Service {
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | null,
    url: row.url as string | null,
    checkType: (row.check_type as ServiceCheckType | undefined) ?? 'http',
    status: row.status as ServiceStatus,
    sortOrder: row.sort_order as number,
    createdAt: (row.created_at as Date).toISOString(),
    expectedStatusCode: (row.expected_status_code as number) ?? 200,
  };
}

function mapAdminService(row: Record<string, unknown>): Service {
  return {
    ...mapService(row),
    jellyfinUsername: row.jellyfin_username as string | null,
    jellyfinMediaUrl: row.jellyfin_media_url as string | null,
    hasJellyfinPassword: Boolean(row.has_jellyfin_password),
  };
}

function mapHealthCheckService(row: Record<string, unknown>): ServiceForHealthCheck {
  return {
    ...mapService(row),
    jellyfinUsername: row.jellyfin_username as string | null,
    jellyfinPassword: row.jellyfin_password as string | null,
    jellyfinMediaUrl: row.jellyfin_media_url as string | null,
    hasJellyfinPassword: Boolean(row.jellyfin_password),
  };
}

function rememberServices(services: ServiceForHealthCheck[]): void {
  replaceCachedServices(services);
}

function rememberService(service: ServiceForHealthCheck): void {
  const state = getServiceCacheState();
  if (!state.services) {
    state.services = [cloneHealthCheckService(service)];
    return;
  }

  const serviceIndex = state.services.findIndex((item) => item.id === service.id);
  const cachedService = mergeCachedService(service, state.services[serviceIndex]);
  if (serviceIndex === -1) {
    state.services = [...state.services, cachedService];
  } else {
    state.services = state.services.map((item, index) =>
      index === serviceIndex ? cachedService : item
    );
  }

  state.services.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function replaceCachedServices(services: ServiceForHealthCheck[]): void {
  const state = getServiceCacheState();
  const existingById = new Map(
    (state.services ?? []).map((service) => [service.id, service])
  );

  state.services = services
    .map((service) => mergeCachedService(service, existingById.get(service.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function getCachedServiceById(id: number): ServiceForHealthCheck | null {
  const service = getServiceCacheState().services?.find(
    (item) => item.id === id
  );
  return service ? cloneHealthCheckService(service) : null;
}

function updateCachedService(
  id: number,
  data: UpdateServiceInput
): ServiceForHealthCheck | null {
  const state = getServiceCacheState();
  if (!state.services) {
    return null;
  }

  const serviceIndex = state.services.findIndex((service) => service.id === id);
  if (serviceIndex === -1) {
    return null;
  }

  const service = state.services[serviceIndex];
  const nextService: ServiceForHealthCheck = {
    ...service,
    name: data.name ?? service.name,
    description:
      data.description !== undefined ? data.description : service.description,
    url: data.url !== undefined ? data.url : service.url,
    checkType: data.checkType ?? service.checkType,
    status: data.status ?? service.status,
    sortOrder: data.sortOrder ?? service.sortOrder,
    expectedStatusCode:
      data.expectedStatusCode ?? service.expectedStatusCode,
    jellyfinUsername:
      data.jellyfinUsername !== undefined
        ? data.jellyfinUsername
        : service.jellyfinUsername,
    jellyfinPassword:
      data.jellyfinPassword !== undefined
        ? data.jellyfinPassword
        : service.jellyfinPassword,
    jellyfinMediaUrl:
      data.jellyfinMediaUrl !== undefined
        ? data.jellyfinMediaUrl
        : service.jellyfinMediaUrl,
  };
  nextService.hasJellyfinPassword = Boolean(nextService.jellyfinPassword);

  state.services = state.services
    .map((item, index) => (index === serviceIndex ? nextService : item))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  return cloneHealthCheckService(nextService);
}

function mergeCachedService(
  service: ServiceForHealthCheck,
  existing?: ServiceForHealthCheck
): ServiceForHealthCheck {
  const next = cloneHealthCheckService(service);
  return {
    ...next,
    avgLatency:
      next.avgLatency !== undefined ? next.avgLatency : existing?.avgLatency,
    uptimePercentage:
      next.uptimePercentage !== undefined
        ? next.uptimePercentage
        : existing?.uptimePercentage,
    uptimeDays:
      next.uptimeDays !== undefined
        ? next.uptimeDays
        : existing?.uptimeDays?.map((day) => ({ ...day })),
    jellyfinUsername:
      next.jellyfinUsername !== undefined
        ? next.jellyfinUsername
        : existing?.jellyfinUsername ?? null,
    jellyfinPassword:
      next.jellyfinPassword !== undefined
        ? next.jellyfinPassword
        : existing?.jellyfinPassword ?? null,
    jellyfinMediaUrl:
      next.jellyfinMediaUrl !== undefined
        ? next.jellyfinMediaUrl
        : existing?.jellyfinMediaUrl ?? null,
    hasJellyfinPassword:
      next.hasJellyfinPassword
      ?? existing?.hasJellyfinPassword
      ?? Boolean(next.jellyfinPassword ?? existing?.jellyfinPassword),
  };
}

function toCachedService(service: Service): ServiceForHealthCheck {
  const existing = getCachedServiceById(service.id);
  const healthCheckService = service as Service & {
    jellyfinPassword?: string | null;
  };
  return mergeCachedService(
    {
      ...cloneService(service),
      jellyfinUsername: service.jellyfinUsername ?? existing?.jellyfinUsername ?? null,
      jellyfinPassword:
        healthCheckService.jellyfinPassword ?? existing?.jellyfinPassword ?? null,
      jellyfinMediaUrl: service.jellyfinMediaUrl ?? existing?.jellyfinMediaUrl ?? null,
      hasJellyfinPassword:
        service.hasJellyfinPassword
        ?? existing?.hasJellyfinPassword
        ?? Boolean(healthCheckService.jellyfinPassword ?? existing?.jellyfinPassword),
    },
    existing ?? undefined
  );
}

function buildUpdateFields(
  data: UpdateServiceInput
): Array<[column: string, value: unknown]> {
  const fields: Array<[column: string, value: unknown]> = [];
  if (data.name !== undefined) fields.push(['name', data.name]);
  if (data.description !== undefined) {
    fields.push(['description', data.description]);
  }
  if (data.url !== undefined) fields.push(['url', data.url]);
  if (data.checkType !== undefined) fields.push(['check_type', data.checkType]);
  if (data.status !== undefined) fields.push(['status', data.status]);
  if (data.sortOrder !== undefined) fields.push(['sort_order', data.sortOrder]);
  if (data.expectedStatusCode !== undefined) {
    fields.push(['expected_status_code', data.expectedStatusCode]);
  }
  if (data.jellyfinUsername !== undefined) {
    fields.push(['jellyfin_username', data.jellyfinUsername]);
  }
  if (data.jellyfinPassword !== undefined) {
    fields.push(['jellyfin_password', data.jellyfinPassword]);
  }
  if (data.jellyfinMediaUrl !== undefined) {
    fields.push(['jellyfin_media_url', data.jellyfinMediaUrl]);
  }
  return fields;
}

async function flushBufferedServiceUpdates(): Promise<void> {
  const state = getServiceCacheState();
  if (state.bufferedUpdates.length === 0) {
    return;
  }

  if (state.flushPromise) {
    return state.flushPromise;
  }

  state.flushPromise = (async () => {
    while (state.bufferedUpdates.length > 0) {
      const item = state.bufferedUpdates[0];
      const fields = buildUpdateFields(item.data);

      if (fields.length === 0) {
        state.bufferedUpdates.shift();
        continue;
      }

      const service = await updateServiceInDatabase(item.id, fields);
      state.bufferedUpdates.shift();

      if (!service) {
        console.warn(
          `Dropping buffered update for missing service ${item.id}.`
        );
        forgetService(item.id);
        continue;
      }

      rememberService(service);
    }
  })().finally(() => {
    state.flushPromise = null;
  });

  return state.flushPromise;
}

function bufferServiceUpdate(
  id: number,
  data: UpdateServiceInput,
  error: unknown
): void {
  const state = getServiceCacheState();
  const existing = state.bufferedUpdates.find((item) => item.id === id);

  if (existing) {
    existing.data = { ...existing.data, ...data };
  } else {
    state.bufferedUpdates.push({
      id,
      data: { ...data },
      queuedAt: new Date().toISOString(),
    });
  }

  const overflow = state.bufferedUpdates.length - getServiceUpdateBufferLimit();
  if (overflow > 0) {
    state.bufferedUpdates.splice(0, overflow);
    console.warn(
      `Dropped ${overflow} buffered service update(s) because the ` +
        'in-memory buffer limit was reached.'
    );
  }

  console.warn(
    `Buffered service update for service ${id}; ` +
      `${state.bufferedUpdates.length} pending update(s).`,
    error
  );
}

function getServiceUpdateBufferLimit(): number {
  const configuredLimit = Number(process.env.SERVICE_UPDATE_BUFFER_LIMIT);
  return Number.isInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : DEFAULT_SERVICE_UPDATE_BUFFER_LIMIT;
}

function shouldBufferServiceUpdateError(error: unknown): boolean {
  return !isDatabaseConfigError(error);
}

function isDatabaseConfigError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('DATABASE_URL environment variable is not set');
}

function forgetService(id: number): void {
  const state = getServiceCacheState();
  if (!state.services) {
    return;
  }

  state.services = state.services.filter((service) => service.id !== id);
}

function cloneService(service: Service): Service {
  return {
    ...service,
    uptimeDays: service.uptimeDays?.map((day) => ({ ...day })),
  };
}

function cloneHealthCheckService(service: ServiceForHealthCheck): ServiceForHealthCheck {
  return {
    ...cloneService(service),
    jellyfinPassword: service.jellyfinPassword,
  };
}

function toPublicService(service: Service): Service {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    url: service.url,
    checkType: service.checkType,
    status: service.status,
    sortOrder: service.sortOrder,
    createdAt: service.createdAt,
    expectedStatusCode: service.expectedStatusCode,
    avgLatency: service.avgLatency,
    uptimePercentage: service.uptimePercentage,
    uptimeDays: service.uptimeDays?.map((day) => ({ ...day })),
  };
}

function toAdminService(service: Service): Service {
  return {
    ...toPublicService(service),
    jellyfinUsername: service.jellyfinUsername ?? null,
    jellyfinMediaUrl: service.jellyfinMediaUrl ?? null,
    hasJellyfinPassword: service.hasJellyfinPassword ?? false,
  };
}
