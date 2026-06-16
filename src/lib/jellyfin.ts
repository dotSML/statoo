import type { ServiceStatus } from './types';
import type { ServiceForHealthCheck } from './repository/services';

const PLAYBACK_RANGE_BYTES = 1_048_576;
const PLAYBACK_TIMEOUT_MS = 10_000;
const DEGRADED_AFTER_MS = 5_000;
const AUTH_CACHE_MS = 15 * 60_000;
const MINIMUM_SUCCESS_BYTES = 1;

interface JellyfinAuth {
  token: string;
  userId: string;
  expiresAt: number;
}

interface JellyfinMediaLocation {
  itemId: string;
  streamUrl: string;
}

interface JellyfinProbeResult {
  status: ServiceStatus;
  responseTime: number;
  statusCode: number | null;
}

interface JellyfinAuthCacheState {
  authByKey: Map<string, JellyfinAuth>;
}

export async function checkJellyfinPlayback(
  service: ServiceForHealthCheck
): Promise<JellyfinProbeResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYBACK_TIMEOUT_MS);

  try {
    const baseUrl = normalizeBaseUrl(service.url);
    const username = service.jellyfinUsername?.trim();
    const password = service.jellyfinPassword?.trim();
    const mediaLocation = resolveMediaLocation(
      baseUrl,
      service.jellyfinMediaUrl
    );

    if (!baseUrl || !username || !password || !mediaLocation) {
      return createResult('major_outage', start, null);
    }

    const auth = await authenticateJellyfin(
      baseUrl,
      username,
      password,
      controller.signal
    );
    if (!auth.ok) {
      return createResult(
        deriveFailureStatus(auth.statusCode),
        start,
        auth.statusCode
      );
    }

    const playbackInfo = await fetchPlaybackInfo(
      baseUrl,
      mediaLocation.itemId,
      auth.value.userId,
      auth.value.token,
      controller.signal
    );
    if (!playbackInfo.ok) {
      return createResult(
        deriveFailureStatus(playbackInfo.statusCode),
        start,
        playbackInfo.statusCode
      );
    }

    const stream = await fetch(mediaLocation.streamUrl, {
      method: 'GET',
      headers: buildPlaybackHeaders(auth.value.token),
      signal: controller.signal,
      cache: 'no-store',
    });
    const bytesRead =
      stream.status === 200 || stream.status === 206
        ? await readAtMost(stream, PLAYBACK_RANGE_BYTES)
        : 0;
    const responseTime = Date.now() - start;

    return {
      status: derivePlaybackStatus(stream.status, responseTime, bytesRead),
      responseTime,
      statusCode: stream.status,
    };
  } catch {
    return createResult('major_outage', start, null);
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateJellyfin(
  baseUrl: string,
  username: string,
  password: string,
  signal: AbortSignal
): Promise<
  | { ok: true; value: JellyfinAuth }
  | { ok: false; statusCode: number | null }
> {
  const cacheKey = `${baseUrl}|${username}`;
  const cachedAuth = getJellyfinAuthCacheState().authByKey.get(cacheKey);

  if (cachedAuth && cachedAuth.expiresAt > Date.now()) {
    return { ok: true, value: cachedAuth };
  }

  const response = await fetch(new URL('/Users/AuthenticateByName', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildJellyfinAuthorization(),
    },
    body: JSON.stringify({
      Username: username,
      Pw: password,
    }),
    signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    getJellyfinAuthCacheState().authByKey.delete(cacheKey);
    return { ok: false, statusCode: response.status };
  }

  const body = await response.json();
  const token = stringValue(body.AccessToken) ?? stringValue(body.accessToken);
  const user = objectValue(body.User) ?? objectValue(body.user);
  const userId = user
    ? stringValue(user.Id) ?? stringValue(user.id)
    : null;

  if (!token || !userId) {
    return { ok: false, statusCode: response.status };
  }

  const auth = {
    token,
    userId,
    expiresAt: Date.now() + AUTH_CACHE_MS,
  };
  getJellyfinAuthCacheState().authByKey.set(cacheKey, auth);
  return { ok: true, value: auth };
}

async function fetchPlaybackInfo(
  baseUrl: string,
  itemId: string,
  userId: string,
  token: string,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; statusCode: number | null }> {
  const url = new URL(`/Items/${encodeURIComponent(itemId)}/PlaybackInfo`, baseUrl);
  url.searchParams.set('userId', userId);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: buildJellyfinAuthorization(token),
    },
    signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    return { ok: false, statusCode: response.status };
  }

  const body = await response.json().catch(() => null);
  if (body && typeof body === 'object') {
    const errorCode = (body as { ErrorCode?: unknown; errorCode?: unknown }).ErrorCode
      ?? (body as { ErrorCode?: unknown; errorCode?: unknown }).errorCode;
    const mediaSources = (body as { MediaSources?: unknown; mediaSources?: unknown }).MediaSources
      ?? (body as { MediaSources?: unknown; mediaSources?: unknown }).mediaSources;

    if (errorCode || !Array.isArray(mediaSources) || mediaSources.length === 0) {
      return { ok: false, statusCode: response.status };
    }
  }

  return { ok: true };
}

function resolveMediaLocation(
  baseUrl: string | null,
  value: string | null | undefined
): JellyfinMediaLocation | null {
  if (!baseUrl || !value?.trim()) {
    return null;
  }

  const input = value.trim();

  if (looksLikeItemId(input)) {
    return {
      itemId: input,
      streamUrl: new URL(
        `/Items/${encodeURIComponent(input)}/Download`,
        baseUrl
      ).toString(),
    };
  }

  const mediaUrl = createMediaUrl(baseUrl, input);
  if (!mediaUrl) {
    return null;
  }

  mediaUrl.searchParams.delete('api_key');
  mediaUrl.searchParams.delete('ApiKey');

  const itemId = extractItemId(mediaUrl.pathname);
  if (!itemId) {
    return null;
  }

  return {
    itemId,
    streamUrl: mediaUrl.toString(),
  };
}

function createMediaUrl(baseUrl: string, value: string): URL | null {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

function extractItemId(pathname: string): string | null {
  const match = pathname.match(/\/(?:Items|Videos|Audio)\/([^/]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function looksLikeItemId(value: string): boolean {
  return /^[a-z0-9-]{8,}$/i.test(value);
}

function buildPlaybackHeaders(token: string): HeadersInit {
  return {
    Authorization: buildJellyfinAuthorization(token),
    Range: `bytes=0-${PLAYBACK_RANGE_BYTES - 1}`,
  };
}

function buildJellyfinAuthorization(token?: string): string {
  const parts = [
    'Client="Statoo"',
    'Device="Statoo Monitor"',
    'DeviceId="statoo-monitor"',
    'Version="1.0.0"',
  ];

  if (token) {
    parts.push(`Token="${token}"`);
  }

  return `MediaBrowser ${parts.join(', ')}`;
}

async function readAtMost(response: Response, byteLimit: number): Promise<number> {
  if (!response.body) {
    return 0;
  }

  const reader = response.body.getReader();
  let bytesRead = 0;

  try {
    while (bytesRead < byteLimit) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      bytesRead += result.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return bytesRead;
}

function derivePlaybackStatus(
  statusCode: number,
  responseTime: number,
  bytesRead: number
): ServiceStatus {
  if ((statusCode === 200 || statusCode === 206) && bytesRead >= MINIMUM_SUCCESS_BYTES) {
    return responseTime > DEGRADED_AFTER_MS ? 'degraded' : 'operational';
  }

  return deriveFailureStatus(statusCode);
}

function deriveFailureStatus(statusCode: number | null): ServiceStatus {
  if (
    statusCode === null
    || statusCode === 401
    || statusCode === 403
    || statusCode === 404
    || statusCode >= 500
  ) {
    return 'major_outage';
  }

  return 'partial_outage';
}

function createResult(
  status: ServiceStatus,
  start: number,
  statusCode: number | null
): JellyfinProbeResult {
  return {
    status,
    responseTime: Date.now() - start,
    statusCode,
  };
}

function normalizeBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function getJellyfinAuthCacheState(): JellyfinAuthCacheState {
  const globalState = globalThis as typeof globalThis & {
    __statooJellyfinAuthCache?: JellyfinAuthCacheState;
  };

  if (!globalState.__statooJellyfinAuthCache) {
    globalState.__statooJellyfinAuthCache = {
      authByKey: new Map(),
    };
  }

  return globalState.__statooJellyfinAuthCache;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
