import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getIncidents, createIncident } from '@/lib/repository';
import { ServiceStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const activeOnly = request.nextUrl.searchParams.get('active') === 'true';
    const limitStr = request.nextUrl.searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const incidents = await getIncidents({ activeOnly, limit });
    return NextResponse.json(incidents);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

const VALID_SEVERITIES: ServiceStatus[] = [
  'degraded', 'partial_outage', 'major_outage', 'maintenance',
];

export async function POST(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { serviceId, title, message, severity } = body;

    if (!serviceId || !title || !message || !severity) {
      return NextResponse.json(
        { error: 'serviceId, title, message, and severity are required' },
        { status: 400 }
      );
    }

    if (!VALID_SEVERITIES.includes(severity)) {
      return NextResponse.json(
        { error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` },
        { status: 400 }
      );
    }

    const incident = await createIncident({
      serviceId: parseInt(serviceId, 10),
      title: title.trim(),
      message: message.trim(),
      severity,
    });

    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
