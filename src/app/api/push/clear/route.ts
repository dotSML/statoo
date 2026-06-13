import { NextResponse } from 'next/server';
import { handleAdminApi } from '@/lib/api';
import { deleteAllSubscriptions } from '@/lib/push';

export async function POST() {
  return handleAdminApi('Failed to clear subscriptions', async () => {
    const result = await deleteAllSubscriptions();
    return NextResponse.json(result);
  });
}
