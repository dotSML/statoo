import { NextRequest, NextResponse } from 'next/server';
import { deleteSubscription } from '@/lib/push';

export async function POST(req: NextRequest) {
  try {
    const { endpoint } = await req.json();

    if (!endpoint) {
      return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
    }

    await deleteSubscription(endpoint);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting subscription:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
