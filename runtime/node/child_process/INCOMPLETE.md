# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    interpreted   120 file(s): 104 passed, 6 failed, 9 skipped, 1 not applicable
    compiled      120 file(s):  0 passed, 110 failed, 9 skipped, 1 not applicable

114 by `test-pattern`, 4 claimed in `extra-tests`, 2 local fixtures. 1 passed when the
branch was parked, 42 when this work started.

Measured with `run.mjs --module child_process`, not added up: an earlier batch read 80
where ten individual passes had predicted 81, because one of them came with a
regression.

## What is left: 6 files, each with a cause

The IPC channel works -- fork, `send` each way, the child's `process.send`, `disconnect`,
exit 0, held by `local/ipc-roundtrip-local.js`. Handle passing works: a socket crosses to a
worker. What remains is six files. Three others sat here an hour ago under **observed, not
diagnosed** -- a located assertion and no found mechanism -- and probing each one turned all
three into fixes rather than causes, so that section is gone. The lesson is worth more than
the section was: two of the three were bugs in this module that a plausible-sounding
narrative had already explained away.

    advanced-serialization.js             a Buffer comes back as a Uint8Array
    advanced-serialization-host-objects.js  the same

  `serialization: 'advanced'` round-trips a value through v8's structured clone. The value
  sent is **this profile's** Buffer, which is not node's, so v8 records it as a plain
  Uint8Array and node's deserialiser -- which re-wraps only its own Buffers -- hands back a
  Uint8Array. Measured both ways: node round-trips its own Buffer as a `Buffer`
  (`isBuffer` true); ours returns `ctor=Uint8Array, isBuffer=false`, while `Map` and
  `bigint` in the same message survive intact. So the channel is fine and the realm is not.
  Fixing it means converting our Buffers to the host's on the way out and back again on the
  way in, a deep walk of arbitrary structured data at the boundary, which is a decision
  rather than an oversight. Fourth instance of this family after `atob`, `URL` and the
  child stdio streams.

    fork-stdio.js                         a fourth stdio slot
    constructor.js                        `ChildProcess.prototype.spawn`

  `fork-stdio` wants `child.stdio[4]` -- a slot beyond the three plus the channel.
  `constructor` wants node's internal spawn method on a bare `new ChildProcess()`, which
  means publishing the internal spawn surface.

    pipe-dataflow.js                      `cat.stdout._handle` is undefined

  Not the dataflow. The test instruments node's internals before asserting anything --

      cat.stdout._handle.readStart = common.mustNotCall();

  -- and under `'use strict'` that line throws `TypeError: Cannot set properties of
  undefined`, so the 1MB through `cat | grep | wc` is never reached. Measured both ways:
  node reports `typeof stdout._handle === 'object'` and the assignment succeeds; ours
  reports `undefined` and it throws.

  **And the cheap fix would be a hollow pass.** Handing out a `_handle` object carrying a
  `readStart` this profile never calls would satisfy `mustNotCall` -- while
  `ChildReadable`'s constructor starts reading eagerly, which is the exact thing the test
  exists to forbid. The test's subject is reachable only by first answering the question
  below; the `_handle` is what stops it being asked.

    stdio-reuse-readable-stdio.js         who owns the read

  This one is the ownership question, and it is not the same bug as `pipe-dataflow` despite
  arriving next to it: the file never mentions `_handle`. It hands `p1.stdout` to `head`,
  waits for `head` to exit, and then reads `p1.stdout` from the parent -- legal because
  `head` is no longer reading. Ours reads that stream from the constructor onward, so
  parent and child consume the same pipe. `test-child-process-kill` needs the eager read so
  a killed child's stdout still reaches `end`; the two pull opposite ways and the answer is
  a decision about who owns the read, not a line of code.

## The three that were "observed" and were bugs

  Kept because each one had a story attached that was wrong.

    send-returns-boolean.js   fixed -- and the first fix caused it
    send-keep-open.js         fixed -- `options` was validated and discarded
    test-cluster-net-send.js  fixed -- the received handle was dropped

  `send-keep-open`: `send(message, handle, options, callback)` validated `options` and then
  never passed it on. Silent for every caller except the one that means it --
  `keepOpen: true` tells node not to close the parent's copy of a sent socket, and the test
  then writes to that socket from the parent. Dropped, the parent's half was already gone.

  `send-returns-boolean`: the story was "no backlog of our own". Measured against node,
  rv1..rv4 read **[true, true, false, false] on both** -- forwarding to the host's `send`
  forwards the host's queue, and the backlog needed nothing. The actual fault was the
  callback fix made an hour earlier: `send` returns false for **backpressure**, not failure,
  and node still delivers the message and still calls back with null once the queue drains.
  Synthesising `ERR_IPC_CHANNEL_CLOSED` whenever the return was false turned every backed-up
  send into an error. The callback is now forwarded to the host, which is the only side that
  knows when a message has gone.

  `test-cluster-net-send`: `process.send(msg, socket)` in a child arrives as two values and
  the stand-in forwarded one, at all four of its message sites -- so `assert.ok(handle)`
  failed on a message that had otherwise arrived intact. Sending a handle *to* a child had
  worked all along, which is why nothing pointed here. What the parent now receives is the
  **host's** socket: the descriptor is real and its data flows, but `instanceof net.Socket`
  answers false against our `net`, because adopting it needs a host-to-ours direction `net`
  does not expose. Fifth instance of the realm seam.
