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
}

function getServiceCacheState(): ServiceCacheState {
  const globalState = globalThis as typeof globalThis & {
    __statooServiceCache?: ServiceCacheState;
  };

  if (!globalState.__statooServiceCache) {
    globalState.__statooServiceCache = {
      services: null,
    };
  }

  return globalState.__statooServiceCache;
}

export function getCachedServices(): Service[] {
  const services = getServiceCacheState().services;
  return services ? services.map(toPublicService) : [];
}

export async function getServices(): Promise<Service[]> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `SELECT ${PUBLIC_SERVICE_COLUMNS}
     FROM services
     ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(mapService);
}

export async function getAdminServices(): Promise<Service[]> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `SELECT ${ADMIN_SERVICE_COLUMNS}
     FROM services
     ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(mapAdminService);
}

export async function getServicesForHealthChecks(): Promise<ServiceForHealthCheck[]> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `SELECT ${HEALTH_CHECK_SERVICE_COLUMNS}
     FROM services
     ORDER BY sort_order ASC, id ASC`
  );
  const services = rows.map(mapHealthCheckService);
  rememberServices(services);
  return services;
}

export function getCachedServicesForHealthChecks(): ServiceForHealthCheck[] {
  const services = getServiceCacheState().services;
  return services ? services.map(cloneHealthCheckService) : [];
}

export async function getServiceById(id: number): Promise<Service | null> {
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
  return service;
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
  await ensureMigrated();

  const fields: Array<[column: string, value: unknown]> = [];
  if (data.name !== undefined) fields.push(['name', data.name]);
  if (data.description !== undefined) fields.push(['description', data.description]);
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

  if (fields.length === 0) {
    return getServiceById(id);
  }

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
  if (rows.length === 0) {
    return null;
  }

  const service = mapHealthCheckService(rows[0]);
  rememberService(service);
  return toAdminService(service);
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
  getServiceCacheState().services = services.map(cloneHealthCheckService);
}

function rememberService(service: ServiceForHealthCheck): void {
  const state = getServiceCacheState();
  if (!state.services) {
    return;
  }

  const serviceIndex = state.services.findIndex((item) => item.id === service.id);
  const cachedService = cloneHealthCheckService(service);
  if (serviceIndex === -1) {
    state.services = [...state.services, cachedService];
  } else {
    state.services = state.services.map((item, index) =>
      index === serviceIndex ? cachedService : item
    );
  }

  state.services.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
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
