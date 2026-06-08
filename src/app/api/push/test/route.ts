import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sendTestNotification } from '@/lib/push';

export async function POST() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendTestNotification();

    if (result.total === 0) {
      return NextResponse.json(
        { error: 'No subscribers found. Open the status page and click "Notify Me" first.' },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
