import { NextResponse } from 'next/server';
import { handleAdminApi, handleApi, readJsonObject } from '@/lib/api';
import { validateSession } from '@/lib/auth';
import { getAdminServices, getServices, createService } from '@/lib/repository';
import { parseCreateService } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleApi('Failed to fetch services', async () => {
    const services = await validateSession()
      ? await getAdminServices()
      : await getServices();
    return NextResponse.json(services);
  });
}

export async function POST(request: Request) {
  return handleAdminApi('Failed to create service', async () => {
    const body = await readJsonObject(request);
    const service = await createService(parseCreateService(body));
    return NextResponse.json(service, { status: 201 });
  });
}
