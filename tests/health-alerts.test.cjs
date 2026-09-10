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

test('slow/fast flapping stays quiet; a later outage alerts once and can alert again after recovery', async () => {
  const service = { id: 1, name: 'Example', url: 'https://example.test', status: 'operational' };
  let probeStatus;
  const saved = [];
  const alerts = [];
  const types = loadModule('src/lib/types.ts');
  const { runAllHealthChecks } = loadModule('src/lib/repository/health-checks.ts', {
    '../types': types,
    '../db': {
      ensureMigrated: async () => {},
      getPool: () => ({ query: async (_sql, values) => { saved.push(values[1]); } }),
    },
    '../health': { checkServiceHealth: async () => ({ status: probeStatus, checkedAt: new Date().toISOString() }) },
    './incidents': { getIncidents: async () => [] },
    './services': {
      getServicesForHealthChecks: async () => [{ ...service }],
      updateService: async (_id, changes) => { service.status = changes.status; },
    },
    '../push': { notifyOutage: async (_name, status) => { alerts.push(status); } },
  });
  const sequence = ['degraded', 'operational', 'degraded', 'degraded',
    'major_outage', 'major_outage', 'partial_outage', 'operational', 'partial_outage'];
  for (const status of sequence) {
    probeStatus = status;
    await runAllHealthChecks();
    assert.equal(service.status, status);
  }
  assert.deepEqual(saved, sequence);
  assert.deepEqual(alerts, ['major_outage', 'partial_outage']);
});

test('a service first seen unavailable still sends an outage alert', async () => {
  let alerted = false;
  const { runAllHealthChecks } = loadModule('src/lib/repository/health-checks.ts', {
    '../types': loadModule('src/lib/types.ts'),
    '../db': { ensureMigrated: async () => {}, getPool: () => ({ query: async () => {} }) },
    '../health': { checkServiceHealth: async () => ({ status: 'major_outage' }) },
    './incidents': { getIncidents: async () => [] },
    './services': {
      getServicesForHealthChecks: async () => [{ id: 1, name: 'Example', url: 'https://example.test', status: 'unknown' }],
      updateService: async () => {},
    },
    '../push': { notifyOutage: async () => { alerted = true; } },
  });
  await runAllHealthChecks();
  assert.equal(alerted, true);
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
