'use strict';
// The maxBuffer budget is counted in bytes and spent in characters.
//
// Node's `execFile` calls `child.stdout.setEncoding(encoding)` whenever the
// encoding is a real one, and then measures each chunk with `Buffer.byteLength`
// while truncating it with a `slice`. On a string chunk a slice cuts
// **characters**, so `maxBuffer: 10` against a five-character, thirteen-byte line
// keeps all five characters -- the budget is exceeded, the error is raised, and
// nothing is actually cut.
//
// Read off node first, which is the only reason to believe the shape:
//
//   node -e 'require("child_process").exec(`${process.execPath} -e "console.log(
//     \"中文测试\")"`, {maxBuffer: 10}, (e, out) => console.log(e.code,
//     JSON.stringify(out)))'
//   ERR_CHILD_PROCESS_STDIO_MAXBUFFER "中文测试\n"
//
// Without the `setEncoding` the chunk stays a Buffer, ten bytes is three and a
// third characters, and the caller gets '中文测' plus a replacement character. That
// is the failure this fixture exists to hold: it is the one case in
// test-child-process-exec-maxbuf that byte truncation gets wrong, and that file
// reports it as thirteen callbacks at 0/1 while the real AssertionError is
// swallowed.
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');

const [cmd, opts] = common.escapePOSIXShell`"${process.execPath}" `;

cp.exec(
  `${cmd}-e "console.log('中文测试');"`,
  { ...opts, maxBuffer: 10 },
  common.mustCall((err, stdout, stderr) => {
    assert.ok(err instanceof RangeError, `expected a RangeError, got ${err && err.name}`);
    assert.strictEqual(err.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    assert.strictEqual(err.message, 'stdout maxBuffer length exceeded');
    // Five characters kept, not ten bytes' worth.
    assert.strictEqual(stdout, '中文测试\n');
    assert.strictEqual(stderr, '');
  }),
);
