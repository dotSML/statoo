import { HealthCheckResult, ServiceStatus } from './types';
import { checkJellyfinPlayback } from './jellyfin';
import type { ServiceForHealthCheck } from './repository/services';

const DEGRADED_AFTER_MS = 5_000;
const HTTP_TIMEOUT_MS = 10_000;

export async function checkHealth(url: string | null, expectedStatusCode: number = 200): Promise<HealthCheckResult> {
  if (!url) {
    return {
      status: 'unknown',
      responseTime: null,
      statusCode: null,
      checkedAt: new Date().toISOString(),
      url: null,
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    const responseTime = Date.now() - start;

    const status = deriveStatus(response.status, responseTime, expectedStatusCode);

    return {
      status,
      responseTime,
      statusCode: response.status,
      checkedAt: new Date().toISOString(),
      url,
    };
  } catch {
    const responseTime = Date.now() - start;

    return {
      status: 'major_outage',
      responseTime,
      statusCode: null,
      checkedAt: new Date().toISOString(),
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function deriveStatus(statusCode: number, responseTime: number, expectedStatusCode: number): ServiceStatus {
  const isExpected = expectedStatusCode === 200
    ? (statusCode >= 200 && statusCode < 400)
    : statusCode === expectedStatusCode;

  if (isExpected) {
    if (responseTime > DEGRADED_AFTER_MS) return 'degraded';
    return 'operational';
  }

  if (statusCode >= 500) return 'major_outage';
  return 'partial_outage';
}

export async function checkServiceHealth(
  service: ServiceForHealthCheck
): Promise<HealthCheckResult> {
  if (service.checkType === 'jellyfin') {
    const result = await checkJellyfinPlayback(service);
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      url: service.url,
    };
  }

  return checkHealth(service.url, service.expectedStatusCode);
}
