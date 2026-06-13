import { ensureMigrated, getPool } from '../db';
import type { Service, ServiceStatus } from '../types';

export interface CreateServiceInput {
  name: string;
  description?: string | null;
  url?: string | null;
  expectedStatusCode?: number;
  status?: ServiceStatus;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  url?: string | null;
  status?: ServiceStatus;
  sortOrder?: number;
  expectedStatusCode?: number;
}

const SERVICE_COLUMNS =
  'id, name, description, url, status, sort_order, created_at, expected_status_code';

export async function getServices(): Promise<Service[]> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `SELECT ${SERVICE_COLUMNS}
     FROM services
     ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(mapService);
}

export async function getServiceById(id: number): Promise<Service | null> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `SELECT ${SERVICE_COLUMNS}
     FROM services
     WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? mapService(rows[0]) : null;
}

export async function createService(data: CreateServiceInput): Promise<Service> {
  await ensureMigrated();
  const { rows } = await getPool().query(
    `INSERT INTO services
       (name, description, url, expected_status_code, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      data.url ?? null,
      data.expectedStatusCode ?? 200,
      data.status ?? 'operational',
    ]
  );
  return mapService(rows[0]);
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
  if (data.status !== undefined) fields.push(['status', data.status]);
  if (data.sortOrder !== undefined) fields.push(['sort_order', data.sortOrder]);
  if (data.expectedStatusCode !== undefined) {
    fields.push(['expected_status_code', data.expectedStatusCode]);
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
  return rows.length > 0 ? mapService(rows[0]) : null;
}

export async function deleteService(id: number): Promise<boolean> {
  await ensureMigrated();
  const { rowCount } = await getPool().query(
    'DELETE FROM services WHERE id = $1',
    [id]
  );
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
