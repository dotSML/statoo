import { after, NextResponse } from 'next/server';
import { handleApi } from '@/lib/api';
import {
  getServicesWithStats,
  deriveOverallStatus,
  getIncidents,
  getLastHealthCheckTime,
} from '@/lib/repository';
import { kickMonitor } from '@/lib/monitor';
import type { Incident } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleApi('Failed to fetch status', async () => {
    after(() => kickMonitor());

    const [services, activeIncidents, lastChecked] = await Promise.all([
      getServicesWithStats(),
      getActiveIncidentsSafely(),
      getLastHealthCheckTimeSafely(),
    ]);
    const overallStatus = deriveOverallStatus(services);

    return NextResponse.json({
      status: overallStatus,
      services,
      activeIncidents,
      checkedAt: lastChecked?.toISOString() ?? null,
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

async function getLastHealthCheckTimeSafely(): Promise<Date | null> {
  try {
    return await getLastHealthCheckTime();
  } catch (error) {
    console.warn('Failed to load the last health check time for status API.', error);
    return null;
  }
}
