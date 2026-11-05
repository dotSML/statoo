/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(relativePath, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    console,
    process: { env: {} },
    URL,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  }, { filename });
  return exports;
}

function loadStatusModule() {
  const types = loadModule('src/lib/types.ts');
  return loadModule('src/lib/repository/status.ts', { '../types': types });
}

test('overall status is unknown when no service status is known', () => {
  const { deriveOverallStatus } = loadStatusModule();

  assert.equal(deriveOverallStatus([]), 'unknown');
  assert.equal(
    deriveOverallStatus([{ status: 'unknown' }, { status: 'unknown' }]),
    'unknown'
  );
});

test('known statuses decide the overall status while unknown services are ignored', () => {
  const { deriveOverallStatus } = loadStatusModule();

  assert.equal(
    deriveOverallStatus([
      { status: 'unknown' },
      { status: 'operational' },
      { status: 'degraded' },
    ]),
    'degraded'
  );
  assert.equal(
    deriveOverallStatus([
      { status: 'unknown' },
      { status: 'operational' },
      { status: 'major_outage' },
    ]),
    'major_outage'
  );
  assert.equal(
    deriveOverallStatus([{ status: 'unknown' }, { status: 'operational' }]),
    'operational'
  );
});

test('worst status treats an all-unknown list as unknown', () => {
  const { findWorstStatus } = loadStatusModule();

  assert.equal(findWorstStatus([]), 'unknown');
  assert.equal(findWorstStatus(['unknown']), 'unknown');
  assert.equal(findWorstStatus(['unknown', 'operational']), 'operational');
  assert.equal(findWorstStatus(['unknown', 'degraded']), 'degraded');
  assert.equal(findWorstStatus(['unknown', 'major_outage']), 'major_outage');
});
