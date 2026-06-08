import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { runAllHealthChecks } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runAllHealthChecks();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to run health checks', detail: String(error) },
      { status: 500 }
    );
  }
}
