import { NextResponse } from 'next/server';
import { getServicesWithStats, deriveOverallStatus, getIncidents, ensureHealthChecksUpdated } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch status', detail: String(error) },
      { status: 500 }
    );
  }
}
