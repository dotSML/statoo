import { NextResponse } from 'next/server';
import { getServices, deriveOverallStatus, getIncidents } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const services = await getServices();
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
