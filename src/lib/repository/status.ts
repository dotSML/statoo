import type { Service, ServiceStatus } from '../types';
import { STATUS_SEVERITY } from '../types';

export function deriveOverallStatus(services: Service[]): ServiceStatus {
  return findWorstStatus(services.map((service) => service.status));
}

export function findWorstStatus(statuses: ServiceStatus[]): ServiceStatus {
  if (statuses.length === 0) {
    return 'unknown';
  }

  return statuses.reduce<ServiceStatus>(
    (worst, status) =>
      STATUS_SEVERITY[status] < STATUS_SEVERITY[worst] ? status : worst,
    'operational'
  );
}
