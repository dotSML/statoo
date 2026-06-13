import { NextResponse } from 'next/server';
import { validateSession } from './auth';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function handleApi(
  context: string,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error(`${context}:`, error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function handleAdminApi(
  context: string,
  handler: () => Promise<Response>
): Promise<Response> {
  if (!(await validateSession())) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return handleApi(context, handler);
}

export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError('Request body must be valid JSON', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('Request body must be a JSON object', 400);
  }

  return body as Record<string, unknown>;
}

export function parsePositiveInteger(
  value: unknown,
  field: string
): number {
  const parsed = typeof value === 'number'
    ? value
    : Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(`${field} must be a positive integer`, 400);
  }

  return parsed;
}
