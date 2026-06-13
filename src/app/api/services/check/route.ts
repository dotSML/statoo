import { NextResponse } from 'next/server';
import { handleAdminApi } from '@/lib/api';
import { runAllHealthChecks } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function POST() {
  return handleAdminApi('Failed to run health checks', async () => {
    await runAllHealthChecks();
    return NextResponse.json({ ok: true });
  });
}
