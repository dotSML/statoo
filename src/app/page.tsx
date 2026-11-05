import { after } from 'next/server';
import {
  getServicesWithStats,
  deriveOverallStatus,
  getIncidents,
  getLastHealthCheckTime,
} from '@/lib/repository';
import { kickMonitor } from '@/lib/monitor';
import type { Incident } from '@/lib/types';
import StatusPageClient from './status-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  after(() => kickMonitor());

  const pageTitle = process.env.PAGE_TITLE || 'Status';
  const pageDescription = process.env.PAGE_DESCRIPTION || 'Current service status and uptime';

  const [services, activeIncidents, recentIncidents, lastChecked] =
    await Promise.all([
      getServicesWithStats(),
      getIncidentsSafely({ activeOnly: true }),
      getIncidentsSafely({ activeOnly: false, limit: 10 }),
      getLastHealthCheckTimeSafely(),
    ]);
  const overallStatus = deriveOverallStatus(services);

  return (
    <StatusPageClient
      pageTitle={pageTitle}
      pageDescription={pageDescription}
      services={services}
      activeIncidents={activeIncidents}
      recentIncidents={recentIncidents}
      overallStatus={overallStatus}
      lastCheckedAt={lastChecked?.toISOString() ?? null}
    />
  );
}

async function getIncidentsSafely(options: {
  activeOnly: boolean;
  limit?: number;
}): Promise<Incident[]> {
  try {
    return await getIncidents(options);
  } catch (error) {
    console.warn('Failed to load incidents for the public status page.', error);
    return [];
  }
}

async function getLastHealthCheckTimeSafely(): Promise<Date | null> {
  try {
    return await getLastHealthCheckTime();
  } catch (error) {
    console.warn('Failed to load the last health check time.', error);
    return null;
  }
}
