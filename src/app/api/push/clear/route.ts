import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteAllSubscriptions } from '@/lib/push';

export async function POST() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await deleteAllSubscriptions();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
