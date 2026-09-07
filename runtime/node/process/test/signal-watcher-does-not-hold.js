'use strict';

// Two claims about the signal watcher, one of which a comment asserted and
// nothing checked.
//
// The first is ordinary and node's own test-signal-args.js covers it: a
// listener receives its signal, named as the argument. It is repeated here on
// purpose, because the second assertion is about a process *exiting*, and a
// test that only asserts an exit passes just as well when the listener was
// never registered at all. The pair is the point -- one half shows the watcher
// exists, the other shows it does not overstay.
//
// The second is the claim: the watcher must not hold the process open. Waiting
// for a signal that may never arrive is not work, so a program whose only
// remaining listener is a signal handler still exits when its work is done.
// Node unrefs its handle for exactly this reason. If ours did not, this file
// would not finish and the runner would report a timeout rather than a failed
// assertion -- which is the shape of the bug it is guarding.

const assert = require('assert');

let received;
process.on('SIGUSR1', (name) => { received = name; });
assert.strictEqual(process.listenerCount('SIGUSR1'), 1);

process.kill(process.pid, 'SIGUSR1');

setTimeout(() => {
  assert.strictEqual(received, 'SIGUSR1', 'the signal watcher must deliver its signal');

  // Left registered deliberately. Nothing else keeps this process alive, so
  // reaching the end of this callback has to be enough for it to exit.
  assert.strictEqual(process.listenerCount('SIGUSR1'), 1);
  process.on('SIGUSR2', () => {});
  assert.strictEqual(process.listenerCount('SIGUSR2'), 1);
}, 10);
