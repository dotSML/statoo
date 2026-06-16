import { getServicesWithStats, deriveOverallStatus, getIncidents, ensureHealthChecksUpdated } from '@/lib/repository';
import type { Incident } from '@/lib/types';
import StatusPageClient from './status-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const pageTitle = process.env.PAGE_TITLE || 'Status';
  const pageDescription = process.env.PAGE_DESCRIPTION || 'Current service status and uptime';

  await ensureHealthChecksUpdated();
  const services = await getServicesWithStats();
  const [activeIncidents, recentIncidents] = await Promise.all([
    getIncidentsSafely({ activeOnly: true }),
    getIncidentsSafely({ activeOnly: false, limit: 10 }),
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
