import {
  cleanupOldHealthChecks,
  runAllHealthChecks,
} from './repository/health-checks';

const MONITOR_INTERVAL_MS = 30_000;
const MIN_RUN_SPACING_MS = 20_000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5_000;

interface MonitorState {
  interval: ReturnType<typeof setInterval> | null;
  initialTimer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastRunStartedAt: number;
  lastCleanupAt: number;
}

function getMonitorState(): MonitorState {
  const globalState = globalThis as typeof globalThis & {
    __statooMonitorState?: MonitorState;
  };

  if (!globalState.__statooMonitorState) {
    globalState.__statooMonitorState = {
      interval: null,
      initialTimer: null,
      running: false,
      lastRunStartedAt: 0,
      lastCleanupAt: 0,
    };
  }

  return globalState.__statooMonitorState;
}

/**
 * Start the in-process monitoring loop. Safe to call more than once; the
 * global state is shared across dev-server reloads.
 */
export function startMonitor(): void {
  if (process.env.MONITOR_ENABLED === 'false') {
    return;
  }

  const state = getMonitorState();
  if (state.interval || state.initialTimer) {
    return;
  }

  state.initialTimer = setTimeout(() => {
    state.initialTimer = null;
    void kickMonitor();
  }, INITIAL_DELAY_MS);
  state.initialTimer.unref?.();

  state.interval = setInterval(() => {
    void kickMonitor();
  }, MONITOR_INTERVAL_MS);
  state.interval.unref?.();
}

/**
 * Run a monitoring cycle if one is not already running and enough time has
 * passed since the last attempt. Page/API requests call this after the
 * response has been sent as a fallback for deployments where the scheduler
 * did not start.
 */
export async function kickMonitor(): Promise<void> {
  if (process.env.MONITOR_ENABLED === 'false') {
    return;
  }

  const state = getMonitorState();
  if (state.running) {
    return;
  }

  const now = Date.now();
  if (now - state.lastRunStartedAt < MIN_RUN_SPACING_MS) {
    return;
  }

  state.lastRunStartedAt = now;
  state.running = true;

  try {
    await runAllHealthChecks();
    await maybeCleanupOldHealthChecks(state);
  } catch (error) {
    console.warn('Health check monitor cycle failed.', error);
  } finally {
    state.running = false;
  }
}

async function maybeCleanupOldHealthChecks(
  state: MonitorState
): Promise<void> {
  const now = Date.now();
  if (now - state.lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  state.lastCleanupAt = now;

  try {
    const removed = await cleanupOldHealthChecks();
    if (removed > 0) {
      console.log(`Removed ${removed} health check(s) past the retention window.`);
    }
  } catch (error) {
    console.warn('Failed to clean up old health checks.', error);
  }
}
