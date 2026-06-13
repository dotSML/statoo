import { ApiError, parsePositiveInteger } from './api';
import type { IncidentStatus, ServiceStatus } from './types';
import type {
  CreateIncidentInput,
  UpdateIncidentInput,
} from './repository/incidents';
import type {
  CreateServiceInput,
  UpdateServiceInput,
} from './repository/services';
import type { PushSubscriptionInput } from './push';

const SERVICE_STATUSES: ServiceStatus[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
];
const INCIDENT_SEVERITIES: ServiceStatus[] = [
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
];
const INCIDENT_STATUSES: IncidentStatus[] = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
];

export function parseCreateService(
  body: Record<string, unknown>
): CreateServiceInput {
  return {
    name: requiredString(body.name, 'name'),
    description: nullableString(body.description, 'description'),
    url: nullableString(body.url, 'url'),
    expectedStatusCode: httpStatusCode(body.expectedStatusCode, 200),
    status: serviceStatus(body.status, 'operational'),
  };
}

export function parseUpdateService(
  body: Record<string, unknown>
): UpdateServiceInput {
  const result: UpdateServiceInput = {};

  if ('name' in body) result.name = requiredString(body.name, 'name');
  if ('description' in body) {
    result.description = nullableString(body.description, 'description');
  }
  if ('url' in body) result.url = nullableString(body.url, 'url');
  if ('status' in body) result.status = serviceStatus(body.status);
  if ('sortOrder' in body) {
    result.sortOrder = integer(body.sortOrder, 'sortOrder');
  }
  if ('expectedStatusCode' in body) {
    result.expectedStatusCode = httpStatusCode(body.expectedStatusCode, 200);
  }

  requireUpdateFields(result);
  return result;
}

export function parseCreateIncident(
  body: Record<string, unknown>
): CreateIncidentInput {
  return {
    serviceId: parsePositiveInteger(body.serviceId, 'serviceId'),
    title: requiredString(body.title, 'title'),
    message: requiredString(body.message, 'message'),
    severity: incidentSeverity(body.severity),
  };
}

export function parseUpdateIncident(
  body: Record<string, unknown>
): UpdateIncidentInput {
  const result: UpdateIncidentInput = {};

  if ('title' in body) result.title = requiredString(body.title, 'title');
  if ('message' in body) {
    result.message = requiredString(body.message, 'message');
  }
  if ('severity' in body) {
    result.severity = incidentSeverity(body.severity);
  }
  if ('status' in body) {
    result.status = enumValue(
      body.status,
      'status',
      INCIDENT_STATUSES
    );
  }

  requireUpdateFields(result);
  return result;
}

export function parsePushSubscription(
  body: Record<string, unknown>
): PushSubscriptionInput {
  if (!body.keys || typeof body.keys !== 'object' || Array.isArray(body.keys)) {
    throw new ApiError('keys must be an object', 400);
  }

  const keys = body.keys as Record<string, unknown>;
  return {
    endpoint: pushEndpoint(body.endpoint),
    keys: {
      p256dh: requiredString(keys.p256dh, 'keys.p256dh'),
      auth: requiredString(keys.auth, 'keys.auth'),
    },
  };
}

export function parsePushEndpoint(
  body: Record<string, unknown>
): string {
  return pushEndpoint(body.endpoint);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(`${field} is required`, 400);
  }
  return value.trim();
}

function nullableString(
  value: unknown,
  field: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ApiError(`${field} must be a string`, 400);
  }
  return value.trim() || null;
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'number'
    ? value
    : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ApiError(`${field} must be an integer`, 400);
  }
  return parsed;
}

function pushEndpoint(value: unknown): string {
  const endpoint = requiredString(value, 'endpoint');
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw new ApiError('endpoint must be a valid HTTPS URL', 400);
  }
  return endpoint;
}

function httpStatusCode(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = integer(value, 'expectedStatusCode');
  if (parsed < 100 || parsed > 599) {
    throw new ApiError(
      'expectedStatusCode must be between 100 and 599',
      400
    );
  }
  return parsed;
}

function serviceStatus(
  value: unknown,
  fallback?: ServiceStatus
): ServiceStatus {
  if (value === undefined && fallback) {
    return fallback;
  }
  return enumValue(value, 'status', SERVICE_STATUSES);
}

function incidentSeverity(value: unknown): ServiceStatus {
  return enumValue(
    value,
    'severity',
    INCIDENT_SEVERITIES
  );
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: T[]
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ApiError(
      `${field} must be one of: ${allowed.join(', ')}`,
      400
    );
  }
  return value as T;
}

function requireUpdateFields(value: object): void {
  if (Object.keys(value).length === 0) {
    throw new ApiError('At least one valid field is required', 400);
  }
}
