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
    const { name, description, url } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const service = await createService({
      name: name.trim(),
      description: description?.trim() || undefined,
      url: url?.trim() || undefined,
    });

    return NextResponse.json(service, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
