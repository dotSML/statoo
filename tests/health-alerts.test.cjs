/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production modules with isolated clocks, network and storage.
function loadModule(relativePath, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, console, process: { env: {} }, URL, Response, AbortController,
    setTimeout, clearTimeout,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  }, { filename });
  return exports;
}

function clock() {
  let elapsed = 0;
  let timeout;
  let cleared = false;
  return {
    advance(ms) { elapsed += ms; },
    get timeout() { return timeout; },
    get cleared() { return cleared; },
    globals: {
      Date: class extends Date { static now() { return elapsed; } },
      setTimeout(callback, ms) { timeout = { callback, ms }; return timeout; },
      clearTimeout(value) { assert.equal(value, timeout); cleared = true; },
    },
  };
}

test('HTTP warnings allow five seconds; response errors still report outages', async () => {
  for (const [ms, code, expectedCode, expected] of [
    [2_500, 200, 200, 'operational'],
    [5_000, 200, 200, 'operational'],
    [5_001, 200, 200, 'degraded'],
    [6_000, 302, 200, 'degraded'],
    [100, 204, 204, 'operational'],
    [100, 404, 404, 'operational'],
    [100, 404, 200, 'partial_outage'],
    [6_000, 503, 200, 'major_outage'],
  ]) {
    const time = clock();
    const { checkHealth } = loadModule('src/lib/health.ts', { './jellyfin': {} }, {
      ...time.globals,
      fetch: async () => { time.advance(ms); return { status: code }; },
    });
    const result = await checkHealth('https://example.test', expectedCode);
    assert.equal(result.status, expected, `${ms} ms, HTTP ${code}`);
    assert.equal(result.responseTime, ms);
    assert.equal(time.timeout.ms, 10_000);
    assert.equal(time.cleared, true);
  }
});

test('HTTP network errors and timeouts remain outages and clear their timer', async () => {
  for (const timedOut of [false, true]) {
    const time = clock();
    const { checkHealth } = loadModule('src/lib/health.ts', { './jellyfin': {} }, {
      ...time.globals,
      fetch: async (_url, options) => {
        if (timedOut) {
          time.advance(time.timeout.ms);
          time.timeout.callback();
          assert.equal(options.signal.aborted, true);
        }
        throw new Error('Connection failed');
      },
    });
    assert.equal((await checkHealth('https://example.test')).status, 'major_outage');
    assert.equal(time.cleared, true);
    assert.equal((await checkHealth(null)).status, 'unknown');
  }
});

test('Jellyfin allows ten seconds for successful playback, with a twenty-second timeout', async () => {
  for (const [ms, streamCode, bytes, expected] of [
    [6_000, 206, 'media', 'operational'],
    [10_000, 200, 'media', 'operational'],
    [10_001, 206, 'media', 'degraded'],
    [100, 503, '', 'major_outage'],
    [100, 206, '', 'partial_outage'],
  ]) {
    const time = clock();
    let requests = 0;
    const { checkJellyfinPlayback } = loadModule('src/lib/jellyfin.ts', {}, {
      ...time.globals,
      fetch: async () => {
        requests += 1;
        if (requests === 1) return Response.json({ AccessToken: 'test', User: { Id: 'test-user' } });
        if (requests === 2) return Response.json({ MediaSources: [{ Id: 'test-media' }] });
        time.advance(ms);
        return new Response(bytes, { status: streamCode });
      },
    });
    const result = await checkJellyfinPlayback({
      url: 'https://jellyfin.example.test', jellyfinUsername: 'monitor',
      jellyfinPassword: 'test-only', jellyfinMediaUrl: '12345678',
    });
    assert.equal(result.status, expected, `${ms} ms, HTTP ${streamCode}, ${bytes.length} bytes`);
    assert.equal(time.timeout.ms, 20_000);
    assert.equal(time.cleared, true);
  }
});

test('a published slow-response incident is described as slow, never DOWN', async () => {
  const payloads = [];
  const { notifyOutage } = loadModule('src/lib/push.ts', {
    'web-push': { sendNotification: async (_subscription, body) => { payloads.push(JSON.parse(body)); } },
    './db': {
      ensureMigrated: async () => {},
      getPool: () => ({ query: async () => ({ rows: [{ endpoint: 'https://example.test', keys: {} }] }) }),
    },
  }, { console: { ...console, warn() {} } });
  await notifyOutage('Example', 'degraded');
  await notifyOutage('Example', 'major_outage');
  assert.equal(payloads[0].title, 'Example is running slowly');
  assert.doesNotMatch(payloads[0].body, /DOWN|outage/i);
  assert.equal(payloads[1].title, 'Example is unavailable');
});


// Run the production migration, repositories, scheduling SQL and alert policy
// against embedded PostgreSQL; only probes and push delivery are simulated.
async function monitorHarness(t, initialStatus = 'operational') {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  const pool = {
    async query(sql, values) {
      const result = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
      return { ...result, rowCount: result.affectedRows };
    },
  };
  const database = loadModule('src/lib/db.ts', {
    pg: { Pool: class { constructor() { return pool; } } },
  }, { process: { env: { DATABASE_URL: 'test-only' } } });
  await database.ensureMigrated();
  await db.query("INSERT INTO services (name, url, status) VALUES ('Example', 'https://example.test', $1)", [initialStatus]);
  const alerts = [];
  let status = 'operational';
  let probes = 0;
  let incidents = [];
  function worker() {
    const policy = loadModule('src/lib/repository/health-alerts.ts', {
      'node:crypto': require('node:crypto'), '../db': database,
    });
    const services = loadModule('src/lib/repository/services.ts', { '../db': database });
    const runner = loadModule('src/lib/repository/health-checks.ts', {
      '../db': database, '../types': loadModule('src/lib/types.ts'),
      './health-alerts': policy, './services': services,
      './incidents': { getIncidents: async () => incidents },
      '../health': { checkServiceHealth: async () => {
        probes += 1;
        return { status, checkedAt: new Date().toISOString(), url: 'https://example.test', responseTime: 100, statusCode: null };
      } },
      '../push': { notifyOutage: async (_name, severity) => alerts.push(severity) },
    });
    return { ...runner, ...policy };
  }
  const current = worker();
  async function due() {
    await db.exec("UPDATE health_alert_state SET checked_at = NOW() - INTERVAL '61 seconds'");
  }
  return {
    db, current, worker, due, alerts,
    setStatus(value) { status = value; },
    setIncidents(value) { incidents = value; },
    get probes() { return probes; },
    async check(value, runner = current) {
      status = value;
      await due();
      await runner.runAllHealthChecks();
    },
  };
}

test('transient failures and slow responses stay quiet; sustained outages alert once after three failures', async (t) => {
  const h = await monitorHarness(t);
  for (const status of ['degraded', 'operational', 'major_outage', 'operational', 'partial_outage', 'major_outage', 'degraded']) {
    await h.check(status);
    assert.equal(h.alerts.length, 0);
  }
  await h.check('major_outage');
  await h.check('partial_outage');
  assert.equal(h.alerts.length, 0);
  await h.check('major_outage');
  assert.deepEqual(h.alerts, ['major_outage']);
  await h.check('partial_outage');
  await h.check('major_outage');
  assert.equal(h.alerts.length, 1);
});

test('one successful check does not rearm alerts; two successes allow a new confirmed outage', async (t) => {
  const h = await monitorHarness(t);
  for (const status of ['major_outage', 'major_outage', 'major_outage', 'operational', 'major_outage', 'major_outage', 'major_outage']) {
    await h.check(status);
  }
  assert.equal(h.alerts.length, 1);
  await h.check('operational');
  await h.check('degraded');
  for (let i = 0; i < 3; i += 1) await h.check('partial_outage');
  assert.deepEqual(h.alerts, ['major_outage', 'partial_outage']);
});

test('fresh server instances share confirmation state and parallel refreshes perform only one probe', async (t) => {
  const h = await monitorHarness(t);
  h.setStatus('major_outage');
  for (let i = 0; i < 3; i += 1) {
    await h.due();
    await Promise.all(Array.from({ length: 8 }, () => h.worker().ensureHealthChecksUpdated()));
    assert.equal(h.probes, i + 1);
    assert.equal(h.alerts.length, i === 2 ? 1 : 0);
  }
  await h.worker().runAllHealthChecks();
  assert.equal(h.probes, 3, 'manual checks also respect minimum sample spacing');
});

test('unknown results never count as recovery and gaps do not combine old failures', async (t) => {
  const h = await monitorHarness(t, 'unknown');
  await h.check('major_outage');
  await h.check('major_outage');
  await h.db.exec("UPDATE health_alert_state SET checked_at = NOW() - INTERVAL '10 minutes'");
  h.setStatus('major_outage');
  await h.worker().runAllHealthChecks();
  assert.equal(h.alerts.length, 0);
  await h.check('major_outage');
  await h.check('major_outage');
  assert.equal(h.alerts.length, 1);
  for (const status of ['operational', 'unknown', 'operational', 'major_outage', 'major_outage', 'major_outage']) {
    await h.check(status);
  }
  assert.equal(h.alerts.length, 1);
});

test('expired workers cannot claim alerts or release a replacement worker lease', async (t) => {
  const h = await monitorHarness(t);
  await h.check('major_outage');
  await h.check('major_outage');
  await h.due();
  const stale = await h.current.claimHealthCheck(1);
  await h.db.exec("UPDATE health_alert_state SET lease_until = NOW() - INTERVAL '1 second'");
  const replacement = await h.worker().claimHealthCheck(1);
  assert.ok(replacement);
  assert.equal(await h.current.completeHealthCheck(1, stale, 'major_outage'), false);
  await h.current.releaseHealthCheck(1, stale.token);
  assert.equal(await h.current.claimHealthCheck(1), null);
  assert.equal(await h.current.completeHealthCheck(1, replacement, 'major_outage'), true);
  assert.equal(await h.current.completeHealthCheck(1, replacement, 'major_outage'), false);
});

test('existing outages and manual incident overrides do not replay automatic notifications', async (t) => {
  const h = await monitorHarness(t, 'major_outage');
  for (let i = 0; i < 4; i += 1) await h.check('major_outage');
  assert.equal(h.alerts.length, 0);
  h.setIncidents([{ serviceId: 1, severity: 'major_outage' }]);
  for (let i = 0; i < 4; i += 1) await h.check('operational');
  assert.equal(h.alerts.length, 0);
});

test('database failure prevents uncoordinated probes or notifications', async () => {
  let probed = false;
  const { runAllHealthChecks } = loadModule('src/lib/repository/health-checks.ts', {
    '../db': {}, '../types': loadModule('src/lib/types.ts'),
    './health-alerts': { claimHealthCheck: async () => { throw new Error('DB unavailable'); } },
    './services': { getServicesForHealthChecks: async () => [{ id: 1, url: 'https://example.test' }] },
    './incidents': { getIncidents: async () => [] },
    '../health': { checkServiceHealth: async () => { probed = true; } },
  }, { console: { ...console, error() {} } });
  await runAllHealthChecks();
  assert.equal(probed, false);
});

test('HTTP probes cancel response bodies instead of leaving connections occupied', async () => {
  let cancelled = 0;
  const { checkHealth } = loadModule('src/lib/health.ts', { './jellyfin': {} }, {
    fetch: async () => ({ status: 200, body: { cancel: async () => { cancelled += 1; } } }),
  });
  await checkHealth('https://example.test');
  assert.equal(cancelled, 1);
});

test('Jellyfin renews rejected cached tokens for playback info and stream requests', async () => {
  for (const stage of ['PlaybackInfo', 'Download']) {
    let auths = 0;
    let rejected = false;
    const { checkJellyfinPlayback } = loadModule('src/lib/jellyfin.ts', {}, {
      fetch: async (url, options) => {
        const path = new URL(url).pathname;
        if (path.includes('AuthenticateByName')) {
          auths += 1;
          return Response.json({ AccessToken: `token-${auths}`, User: { Id: 'user' } });
        }
        if (rejected && path.includes(stage) && options.headers.Authorization.includes('token-1')) {
          return new Response('', { status: 401 });
        }
        if (path.includes('PlaybackInfo')) return Response.json({ MediaSources: [{ Id: 'media' }] });
        return new Response('media', { status: 206 });
      },
    });
    const service = { url: 'https://jellyfin.example.test', jellyfinUsername: 'monitor', jellyfinPassword: 'test-only', jellyfinMediaUrl: '12345678' };
    assert.equal((await checkJellyfinPlayback(service)).status, 'operational');
    rejected = true;
    assert.equal((await checkJellyfinPlayback(service)).status, 'operational');
    assert.equal(auths, 2, stage);
  }
});

test('persistent Jellyfin authorization failures stop after one retry', async () => {
  let auths = 0;
  const { checkJellyfinPlayback } = loadModule('src/lib/jellyfin.ts', {}, {
    fetch: async (url) => {
      if (new URL(url).pathname.includes('AuthenticateByName')) {
        auths += 1;
        return Response.json({ AccessToken: 'rejected', User: { Id: 'user' } });
      }
      return new Response('', { status: 403 });
    },
  });
  const result = await checkJellyfinPlayback({ url: 'https://jellyfin.example.test', jellyfinUsername: 'monitor', jellyfinPassword: 'test-only', jellyfinMediaUrl: '12345678' });
  assert.equal(result.status, 'major_outage');
  assert.equal(auths, 2);
});
