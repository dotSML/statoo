import { NextRequest, NextResponse } from 'next/server';
import {
  ApiError,
  handleAdminApi,
  handleApi,
  readJsonObject,
} from '@/lib/api';
import { getIncidents, createIncident } from '@/lib/repository';
import { parseCreateIncident } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleApi('Failed to fetch incidents', async () => {
    const activeOnly = request.nextUrl.searchParams.get('active') === 'true';
    const limitStr = request.nextUrl.searchParams.get('limit');
    const limit = parseLimit(limitStr);

    const incidents = await getIncidents({ activeOnly, limit });
    return NextResponse.json(incidents);
  });
}

export async function POST(request: Request) {
  return handleAdminApi('Failed to create incident', async () => {
    const body = await readJsonObject(request);
    const incident = await createIncident(parseCreateIncident(body));
    return NextResponse.json(incident, { status: 201 });
  });
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ApiError('limit must be an integer between 1 and 100', 400);
  }
  return parsed;
}
