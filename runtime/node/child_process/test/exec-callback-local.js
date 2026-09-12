'use strict';
// Does `exec`'s callback fire inside the runner?
//
// `test-child-process-exec-encoding.js` reports all four of its callbacks as
// never fired, while the same calls fire correctly from a standalone probe. The
// difference is the harness, and every hypothesis about *which* part of the
// harness has been guesswork. This asks the question from inside it.
const assert = require('assert');
const cp = require('child_process');

let exitFired = false;
let closeFired = false;
let callbackFired = false;

const child = cp.exec('echo hello', (error, stdout, stderr) => {
  callbackFired = true;
  assert.strictEqual(error, null);
  assert.strictEqual(String(stdout), 'hello\n');
  assert.strictEqual(String(stderr), '');
});

child.on('exit', () => { exitFired = true; });
child.on('close', () => { closeFired = true; });

process.on('exit', () => {
  // Reported as an assertion rather than a log, so the runner's verdict carries
  // which of the three stages was reached.
  assert.ok(exitFired, 'the exit event never fired');
  assert.ok(closeFired, 'exit fired but close did not -- stdio never reported EOF');
  assert.ok(callbackFired, 'close fired but the exec callback did not');
});
