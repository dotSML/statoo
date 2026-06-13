import { NextResponse } from 'next/server';
import { handleApi, readJsonObject } from '@/lib/api';
import { deleteSubscription } from '@/lib/push';
import { parsePushEndpoint } from '@/lib/validation';

export async function POST(request: Request) {
  return handleApi('Failed to delete push subscription', async () => {
    const body = await readJsonObject(request);
    const endpoint = parsePushEndpoint(body);
    await deleteSubscription(endpoint);
    return NextResponse.json({ success: true });
  });
}
