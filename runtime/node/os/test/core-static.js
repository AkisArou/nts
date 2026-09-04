'use strict';

// Applicable public behavior from Node v24.20.0
// `test/parallel/test-os.js`. That upstream file ends by installing and
// observing Symbol.toPrimitive hooks on function objects, a section 13
// non-goal; this keeps its statically typed OS surface independently covered.
const assert = require('node:assert');
const hostProcess = require('node:process');
const os = require('node:os');

for (const value of [
  os.hostname(), os.type(), os.release(), os.version(), os.machine(),
  os.arch(), os.platform(), os.homedir(), os.tmpdir(), os.endianness(),
]) {
  assert.strictEqual(typeof value, 'string');
  assert.ok(value.length > 0);
}

assert.strictEqual(os.arch(), hostProcess.arch);
assert.strictEqual(os.platform(), hostProcess.platform);
assert.match(os.endianness(), /^(?:BE|LE)$/);
assert.strictEqual(os.EOL, hostProcess.platform === 'win32' ? '\r\n' : '\n');
assert.strictEqual(os.devNull, hostProcess.platform === 'win32' ? '\\\\.\\nul' : '/dev/null');

assert.ok(os.uptime() > 0);
assert.ok(os.totalmem() > 0);
assert.ok(os.freemem() > 0);
assert.ok(os.availableParallelism() > 0);

const averages = os.loadavg();
assert.strictEqual(averages.length, 3);
for (const average of averages) assert.strictEqual(typeof average, 'number');

const cpus = os.cpus();
assert.ok(cpus.length > 0);
for (const cpu of cpus) {
  assert.strictEqual(typeof cpu.model, 'string');
  assert.strictEqual(typeof cpu.speed, 'number');
  for (const time of Object.values(cpu.times)) {
    assert.strictEqual(typeof time, 'number');
  }
}

const interfaces = os.networkInterfaces();
for (const entries of Object.values(interfaces)) {
  for (const entry of entries) {
    assert.match(entry.family, /^IPv[46]$/);
    assert.strictEqual(typeof entry.address, 'string');
    assert.strictEqual(typeof entry.netmask, 'string');
    assert.strictEqual(typeof entry.mac, 'string');
    assert.strictEqual(typeof entry.internal, 'boolean');
    assert.ok(entry.cidr === null || entry.cidr.startsWith(`${entry.address}/`));
    if (entry.scopeid !== undefined) assert.strictEqual(typeof entry.scopeid, 'number');
  }
}

const user = os.userInfo();
assert.strictEqual(typeof user.uid, 'number');
assert.strictEqual(typeof user.gid, 'number');
assert.strictEqual(typeof user.username, 'string');
assert.strictEqual(typeof user.homedir, 'string');
assert.ok(user.shell === null || typeof user.shell === 'string');
