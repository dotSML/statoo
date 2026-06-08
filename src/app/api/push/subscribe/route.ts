import { NextRequest, NextResponse } from 'next/server';
import { saveSubscription } from '@/lib/push';

export async function POST(req: NextRequest) {
  try {
    const { endpoint, keys } = await req.json();

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return NextResponse.json({ error: 'Missing endpoint or keys' }, { status: 400 });
    }

    await saveSubscription(endpoint, keys);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error saving subscription:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
