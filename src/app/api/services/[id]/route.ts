import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateService, deleteService } from '@/lib/repository';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    if (body.expectedStatusCode !== undefined && body.expectedStatusCode !== null && body.expectedStatusCode !== '') {
      const parsed = parseInt(String(body.expectedStatusCode), 10);
      if (isNaN(parsed) || parsed < 100 || parsed > 599) {
        return NextResponse.json({ error: 'Expected status code must be a valid HTTP status code (100-599)' }, { status: 400 });
      }
      body.expectedStatusCode = parsed;
    } else if (body.expectedStatusCode === '') {
      body.expectedStatusCode = 200;
    }

    const service = await updateService(parseInt(id, 10), body);

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json(service);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const deleted = await deleteService(parseInt(id, 10));

    if (!deleted) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
