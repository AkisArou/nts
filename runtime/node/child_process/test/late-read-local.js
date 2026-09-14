'use strict';
// Reading a child's stdout **late**, in two arms that differ in one thing: whether the stream
// was handed to another child first.
//
// `test-child-process-stdio-reuse-readable-stdio` is the upstream file, and it has only the
// second arm. Without the first, a failure there says "late reads are broken" and "handed-over
// streams are broken" with equal plausibility, and the recorded cause was the wrong one of those
// for a long time. The pair separates them in one run:
//
//     one child, reader attached late           host stream `flowing=null`   delivers
//     stdout handed over, reader attached late  host stream `flowing=false`  delivered nothing
//
// The mechanism is node's, on both sides. `Readable.prototype.on("data")` resumes only when
// `state.flowing !== false`, so a stream that has merely never been read starts and one that was
// *explicitly paused* does not. And node explicitly pauses the parent's reader when it gives the
// stream to another child -- `lib/internal/child_process.js`, the `type === 'wrap'` branch:
//
//     stream.handle.readStop();
//     stream._stdio.pause();
//     stream._stdio.readableFlowing = false;
//
// which is correct of node and is why `nts_child_process_read_start` has to `resume()` rather
// than rely on attaching a listener.
const common = require('../common');
const assert = require('assert');
const { spawn } = require('child_process');

// Arm 1 -- the control. No handover; the reader is still attached late.
{
  const solo = spawn('cat', { stdio: ['pipe', 'pipe', 'inherit'] });
  solo.stdin.end('alone\n');
  setTimeout(common.mustCall(() => {
    solo.stdout.setEncoding('utf8');
    let seen = '';
    solo.stdout.on('data', (chunk) => { seen += chunk; });
    solo.stdout.on('end', common.mustCall(() => {
      assert.strictEqual(seen, 'alone\n');
    }));
    solo.stdout.resume();
  }), 200);
}

// Arm 2 -- the same lateness, with the stream handed to `head` first. `head -n1` takes the first
// line and exits, after which reading the rest from the parent is legal.
{
  const p1 = spawn('cat', { stdio: ['pipe', 'pipe', 'inherit'] });
  const p2 = spawn('head', ['-n1'], { stdio: [p1.stdout, 'pipe', 'inherit'] });
  p1.stdin.write('first\n');
  p2.stdout.setEncoding('utf8');
  p2.stdout.on('data', common.mustCall((chunk) => {
    assert.strictEqual(chunk, 'first\n');
  }));
  p2.on('exit', common.mustCall(() => {
    p1.stdin.end('second\n');
    p1.stdout.setEncoding('utf8');
    let seen = '';
    p1.stdout.on('data', (chunk) => { seen += chunk; });
    p1.stdout.on('end', common.mustCall(() => {
      assert.strictEqual(seen, 'second\n');
    }));
    p1.stdout.resume();
  }));
}
