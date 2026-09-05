'use strict';

// Extracted from upstream test-memory-usage.js and test-resource-usage.js.
// Node's full memory test also requires V8's separate ArrayBuffer/external-
// memory accounting. NTS accounts its managed heap directly, but the ordinary
// record returned by memoryUsage and the libuv resource record remain public
// supported behavior. The separately implemented `memoryUsage.rss` operation
// is exercised by the untouched upstream EMFILE fixture.
require('../common');
const assert = require('assert');

const memory = process.memoryUsage();
const memoryFields = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'];
assert.deepStrictEqual(Object.keys(memory).sort(), memoryFields.sort());
for (const name of memoryFields) {
  assert.strictEqual(typeof memory[name], 'number', `${name} should be a number`);
  assert(memory[name] >= 0, `${name} should be non-negative`);
}
assert(memory.rss > 0, 'rss should be positive on this POSIX profile');

const usage = process.resourceUsage();
const usageFields = [
  'userCPUTime',
  'systemCPUTime',
  'maxRSS',
  'sharedMemorySize',
  'unsharedDataSize',
  'unsharedStackSize',
  'minorPageFault',
  'majorPageFault',
  'swappedOut',
  'fsRead',
  'fsWrite',
  'ipcSent',
  'ipcReceived',
  'signalsCount',
  'voluntaryContextSwitches',
  'involuntaryContextSwitches',
];
assert.deepStrictEqual(Object.keys(usage).sort(), usageFields.sort());
for (const name of usageFields) {
  assert.strictEqual(typeof usage[name], 'number', `${name} should be a number`);
  assert(usage[name] >= 0, `${name} should be non-negative`);
}
