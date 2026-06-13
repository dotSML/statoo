import { NextResponse } from 'next/server';
import { ApiError, handleApi, readJsonObject } from '@/lib/api';
import { verifyPassword, createSession, destroySession } from '@/lib/auth';

export async function POST(request: Request) {
  return handleApi('Failed to create session', async () => {
    const body = await readJsonObject(request);
    const password = body.password;

    if (typeof password !== 'string') {
      throw new ApiError('password is required', 400);
    }
    if (!verifyPassword(password)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    await createSession();
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE() {
  return handleApi('Failed to destroy session', async () => {
    await destroySession();
    return NextResponse.json({ ok: true });
  });
}
