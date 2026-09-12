'use strict';
// The failing test's exact shape: `escapePOSIXShell`, which passes values through
// the environment and leaves `${ESCAPED_0}` in the command for the shell to
// expand. If this passes, the defect is elsewhere in that test; if it fails, this
// is the smallest reproduction of it inside the harness.
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');

const [cmd, opts] = common.escapePOSIXShell`"${process.execPath}" -e ${'console.log("ok")'}`;
const options = { env: { ...opts?.env } };

let fired = false;
cp.exec(cmd, options, (error, stdout, stderr) => {
  fired = true;
  assert.strictEqual(error, null, `exec errored: ${error && error.message}`);
  assert.strictEqual(String(stdout).trim(), 'ok', `stdout was ${JSON.stringify(String(stdout))}`);
});

process.on('exit', () => {
  assert.ok(fired, 'the exec callback never fired for an escapePOSIXShell command');
});
