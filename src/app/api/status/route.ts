import { NextResponse } from 'next/server';
import { handleApi } from '@/lib/api';
import { getServicesWithStats, deriveOverallStatus, getIncidents, ensureHealthChecksUpdated } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleApi('Failed to fetch status', async () => {
    await ensureHealthChecksUpdated();
    const services = await getServicesWithStats();
    const activeIncidents = await getIncidents({ activeOnly: true });
    const overallStatus = deriveOverallStatus(services);

    return NextResponse.json({
      status: overallStatus,
      services,
      activeIncidents,
      checkedAt: new Date().toISOString(),
    });
  });
}
