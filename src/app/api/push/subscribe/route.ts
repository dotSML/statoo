import { NextResponse } from 'next/server';
import { handleApi, readJsonObject } from '@/lib/api';
import { saveSubscription } from '@/lib/push';
import { parsePushSubscription } from '@/lib/validation';

export async function POST(request: Request) {
  return handleApi('Failed to save push subscription', async () => {
    const body = await readJsonObject(request);
    const { endpoint, keys } = parsePushSubscription(body);
    await saveSubscription(endpoint, keys);
    return NextResponse.json({ success: true });
  });
}
