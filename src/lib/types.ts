export type ServiceStatus =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown';

export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved';

export interface Service {
  id: number;
  name: string;
  description: string | null;
  url: string | null;
  status: ServiceStatus;
  sortOrder: number;
  createdAt: string;
  avgLatency?: number | null;
  uptimePercentage?: number | null;
  uptimeDays?: UptimeDay[];
}

export interface HealthCheckResult {
  status: ServiceStatus;
  responseTime: number | null;
  statusCode: number | null;
  checkedAt: string;
  url: string | null;
  serviceId?: number;
}

export interface UptimeDay {
  date: string;
  status: ServiceStatus;
  avgResponseTime?: number | null;
}

export interface Incident {
  id: number;
  serviceId: number;
  serviceName?: string;
  title: string;
  message: string;
  severity: ServiceStatus;
  status: IncidentStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export const STATUS_LABELS: Record<ServiceStatus, string> = {
  operational: 'All Systems Operational',
  degraded: 'Degraded Performance',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Under Maintenance',
  unknown: 'Unable to Determine',
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

/** Status severity ordering (lower = worse) */
export const STATUS_SEVERITY: Record<ServiceStatus, number> = {
  major_outage: 1,
  partial_outage: 2,
  degraded: 3,
  maintenance: 4,
  operational: 5,
  unknown: 6,
};
