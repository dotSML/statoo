import { cookies } from 'next/headers';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const COOKIE_NAME = 'statoo_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('ADMIN_PASSWORD environment variable is not set');
  return password;
}

/**
 * Create a signed session token using HMAC.
 * Token format: <random_nonce>.<timestamp>.<signature>
 */
export function createSessionToken(): string {
  const nonce = randomBytes(16).toString('hex');
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${timestamp}`;
  const signature = createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

/**
 * Verify a session token is valid and not expired.
 */
export function verifySessionToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [nonce, timestamp, signature] = parts;
  const payload = `${nonce}.${timestamp}`;

  // Verify signature
  const expected = createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');

  if (!safeEqual(signature, expected)) return false;

  // Check expiry
  const created = parseInt(timestamp, 10);
  if (isNaN(created)) return false;
  if (Date.now() - created > SESSION_MAX_AGE * 1000) return false;

  return true;
}

/**
 * Verify admin password.
 */
export function verifyPassword(password: string): boolean {
  const supplied = createHash('sha256').update(password).digest();
  const expected = createHash('sha256').update(getSecret()).digest();
  return timingSafeEqual(supplied, expected);
}

/**
 * Set session cookie after successful login.
 */
export async function createSession(): Promise<void> {
  const token = createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Validate the current session from cookies. Returns true if admin is authenticated.
 */
export async function validateSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME);
    if (!cookie?.value) return false;
    return verifySessionToken(cookie.value);
  } catch {
    return false;
  }
}

/**
 * Destroy the session (logout).
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}
