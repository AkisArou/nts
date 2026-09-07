'use strict';

// `process.stdout.end()` does not end anything, which is what node's
// test-stdout-cannot-be-closed-child-process-pipe.js is named after: the
// stream's `_destroy` is a no-op, so the final chunk is flushed and the
// descriptor stays open. A program cannot take the process's own output away
// from the rest of the program.
//
// The part that file does *not* check, and that a comment in
// `internal/stdio.ts` asserted on its own, is what a later write does. On a
// real `Writable` it would report ERR_STREAM_WRITE_AFTER_END; this class is
// deliberately the smaller protocol its header describes, so the write
// succeeds. That difference is now measured rather than only claimed.
//
// Written against stderr rather than stdout so the runner's own result line is
// not sharing a stream with the subject.

const assert = require('assert');

assert.strictEqual(typeof process.stderr.end, 'function');

let finished = 0;
process.stderr.on('finish', () => { finished += 1; });

assert.strictEqual(process.stderr.end(''), process.stderr, 'end returns the stream');
assert.strictEqual(finished, 1, 'end emits finish');

// The claim under test: the descriptor is still there and still writable.
assert.strictEqual(process.stderr.write(''), true, 'a write after end still succeeds');
assert.strictEqual(process.stderr.write('', () => {}), true, 'and still runs its callback');
