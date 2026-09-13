# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    interpreted   119 file(s): 103 passed, 6 failed, 9 skipped, 1 not applicable
    compiled      119 file(s):   PUBLISHES NOTHING on that lane -- see below

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
  rather than an oversight. Third instance of this family, with the child stdio streams
  and the handle received from a child below -- and the count is three rather than the
  five an earlier version of this file claimed. `atob` and `URL` were cited as members
  and are not: the ledger records both as *absent from the compiled boundary* through a
  refusal cascade, which is a different fact from an object of ours failing an
  `instanceof` against node's. A running tally that says "fourth instance" without
  re-reading the first three is a claim about the sentence, not about the tree.

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

### `stdio-reuse-readable-stdio` and `pipe-dataflow` want opposite handoffs, and the price is measured

**The earlier account here was wrong twice and is replaced.** It first called this "a decision
about who owns the read". It then said node calls `readStart` in neither arrangement -- a
measurement whose hook was on the *instance*, installed after `spawn` had returned, while node
calls it during `spawn`.

Hooking `Pipe.prototype.readStart` before any child exists, for one `spawn`:

    readStart calls during spawn   2      (stdout and stderr)
    cat.stdout.fd                  undefined
    cat.stdout.isPaused()          false
    readableLength after a turn    65536

So node reads a child's stdio eagerly and buffers 64KB, exactly as this profile does.

And hooking `Pipe.prototype.readStop` across a handoff:

    before the handoff   isPaused=false destroyed=false
    after                isPaused=true  destroyed=false  readStop=1  handle=present
    later                readableLength=0

**node pauses the parent's reader and keeps the handle.** The child gets a duplicate, the parent
consumes nothing meanwhile, and the parent can `resume()` afterwards. One mechanism serving both
tests.

This stand-in cannot currently produce that combination, and the two arms have been measured:

    handing the host stream       pipe-dataflow PASSES,  stdio-reuse FAILS
    handing its descriptor,       pipe-dataflow FAILS,   stdio-reuse PASSES
    with the stream paused        (`wc` counts 983041 of 1048577 -- exactly 65536
                                   short, one 64KB read, 4 of 5 runs)

The stream is what the tree hands over, because that is node's branch and it keeps
`pipe-dataflow`'s 1MB intact. `stdio-reuse-readable-stdio` is the price: with the handle
transferred by node's wrap branch, the parent's later `resume()` reaches a socket that produces
nothing, though it reports `destroyed=false readable=true`.

**What would close it:** reproducing node's pause-and-keep rather than choosing between transfer
and duplicate -- most likely handing the descriptor *and* stopping the host's reader before it
has buffered anything, which `pause()` in `hostStream` did not achieve because the 64KB was
already in flight. That is one more measurement, not a redesign.

