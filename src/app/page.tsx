import { getServices, deriveOverallStatus, getIncidents } from '@/lib/repository';
import StatusPageClient from './status-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const pageTitle = process.env.PAGE_TITLE || 'Status';
  const pageDescription = process.env.PAGE_DESCRIPTION || 'Current service status and uptime';

  const services = await getServices();
  const activeIncidents = await getIncidents({ activeOnly: true });
  const recentIncidents = await getIncidents({ activeOnly: false, limit: 10 });
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
