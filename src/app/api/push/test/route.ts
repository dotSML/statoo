import { NextResponse } from 'next/server';
import { handleAdminApi } from '@/lib/api';
import { sendTestNotification } from '@/lib/push';

export async function POST() {
  return handleAdminApi('Failed to send test notification', async () => {
    const result = await sendTestNotification();

    if (result.total === 0) {
      return NextResponse.json(
        { error: 'No subscribers found. Open the status page and click "Notify Me" first.' },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  });
}
