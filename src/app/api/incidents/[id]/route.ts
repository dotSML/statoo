import { NextResponse } from 'next/server';
import {
  handleAdminApi,
  parsePositiveInteger,
  readJsonObject,
} from '@/lib/api';
import { updateIncident, deleteIncident } from '@/lib/repository';
import { parseUpdateIncident } from '@/lib/validation';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleAdminApi('Failed to update incident', async () => {
    const { id } = await params;
    const body = await readJsonObject(request);
    const incident = await updateIncident(
      parsePositiveInteger(id, 'id'),
      parseUpdateIncident(body)
    );

    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json(incident);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleAdminApi('Failed to delete incident', async () => {
    const { id } = await params;
    const deleted = await deleteIncident(parsePositiveInteger(id, 'id'));

    if (!deleted) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
