import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServices, createService } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const services = await getServices();
    return NextResponse.json(services);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, description, url, expectedStatusCode } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    let parsedExpectedStatusCode = 200;
    if (expectedStatusCode !== undefined && expectedStatusCode !== null && expectedStatusCode !== '') {
      parsedExpectedStatusCode = parseInt(String(expectedStatusCode), 10);
      if (isNaN(parsedExpectedStatusCode) || parsedExpectedStatusCode < 100 || parsedExpectedStatusCode > 599) {
        return NextResponse.json({ error: 'Expected status code must be a valid HTTP status code (100-599)' }, { status: 400 });
      }
    }

    const service = await createService({
      name: name.trim(),
      description: description?.trim() || undefined,
      url: url?.trim() || undefined,
      expectedStatusCode: parsedExpectedStatusCode,
    });

    return NextResponse.json(service, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
