export async function register() {
  // The monitor needs Node APIs (pg, timers). It is not compatible with the
  // edge runtime, and it must not connect to the database during a build.
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const { startMonitor } = await import('./lib/monitor');
  startMonitor();
}
