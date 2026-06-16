import { NextResponse } from 'next/server';
import { handleAdminApi } from '@/lib/api';
import { checkDatabaseStatus } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleAdminApi('Failed to check database status', async () => {
    const status = await checkDatabaseStatus();
    return NextResponse.json(status);
  });
}
