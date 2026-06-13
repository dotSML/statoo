import { NextResponse } from 'next/server';
import {
  handleAdminApi,
  parsePositiveInteger,
  readJsonObject,
} from '@/lib/api';
import { updateService, deleteService } from '@/lib/repository';
import { parseUpdateService } from '@/lib/validation';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleAdminApi('Failed to update service', async () => {
    const { id } = await params;
    const serviceId = parsePositiveInteger(id, 'id');
    const body = await readJsonObject(request);
    const service = await updateService(
      serviceId,
      parseUpdateService(body)
    );

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json(service);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleAdminApi('Failed to delete service', async () => {
    const { id } = await params;
    const deleted = await deleteService(parsePositiveInteger(id, 'id'));

    if (!deleted) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
