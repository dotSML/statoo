import { NextResponse } from 'next/server';
import { handleApi } from '@/lib/api';
import { getServicesWithStats, deriveOverallStatus, getIncidents, ensureHealthChecksUpdated } from '@/lib/repository';
import type { Incident } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleApi('Failed to fetch status', async () => {
    await ensureHealthChecksUpdated();
    const services = await getServicesWithStats();
    const activeIncidents = await getActiveIncidentsSafely();
    const overallStatus = deriveOverallStatus(services);

    return NextResponse.json({
      status: overallStatus,
      services,
      activeIncidents,
      checkedAt: new Date().toISOString(),
    });
  });
}

async function getActiveIncidentsSafely(): Promise<Incident[]> {
  try {
    return await getIncidents({ activeOnly: true });
  } catch (error) {
    console.warn('Failed to load active incidents for status API.', error);
    return [];
  }
}
