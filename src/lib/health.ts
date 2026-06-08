import { HealthCheckResult, ServiceStatus } from './types';

export async function checkHealth(url: string | null): Promise<HealthCheckResult> {
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeout);
    const responseTime = Date.now() - start;

    const status = deriveStatus(response.status, responseTime);

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
  }
}

function deriveStatus(statusCode: number, responseTime: number): ServiceStatus {
  if (statusCode >= 500) return 'major_outage';
  if (statusCode >= 400) return 'partial_outage';
  if (responseTime > 5000) return 'degraded';
  if (responseTime > 2000) return 'degraded';
  return 'operational';
}
