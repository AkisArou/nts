# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    interpreted   120 file(s): 109 passed, 0 failed, 9 skipped, 2 not applicable
    compiled      119 file(s):   PUBLISHES NOTHING on that lane -- see below

114 by `test-pattern`, 4 claimed in `extra-tests`, 3 local fixtures. 1 passed when the
branch was parked, 42 when this work started. **Zero failing** as of the `resume()` below.

Measured with `run.mjs --module child_process`, not added up: an earlier batch read 80
where ten individual passes had predicted 81, because one of them came with a
regression.

## What is left: nothing failing, and the six that were

    interpreted   120 file(s): 109 passed, 0 failed, 9 skipped, 2 not applicable

The IPC channel works -- fork, `send` each way, the child's `process.send`, `disconnect`,
exit 0, held by `local/ipc-roundtrip-local.js`. Handle passing works: a socket crosses to a
worker.

**All six files this section used to list are closed**, so what follows is the record of their
causes rather than a list of remainders. Kept because the causes were instructive and two of them
were instructive about *how the causes had been described*:

    advanced-serialization.js             a Buffer comes back as a Uint8Array      -> passes
    advanced-serialization-host-objects.js  needs `internal/test/binding`          -> n/a
    fork-stdio.js                         a fourth stdio slot                      -> passes
    constructor.js                        `ChildProcess.prototype.spawn`           -> passes
    pipe-dataflow.js                      `cat.stdout._handle` is undefined        -> passes
    stdio-reuse-readable-stdio.js         who owns the read                        -> passes

Three others sat here once under **observed, not diagnosed** -- a located assertion and no found
mechanism -- and probing each one turned all three into fixes rather than causes. The lesson is
worth more than that section was: two of the three were bugs in this module that a
plausible-sounding narrative had already explained away. `stdio-reuse-readable-stdio` below is the
fourth and largest instance of the same thing, and the narrative there was one I had written and
re-measured twice.

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

### `stdio-reuse-readable-stdio` -- closed, and the price written here was the wrong direction

**The earlier account was wrong three times and is replaced.** It first called this "a decision
about who owns the read". It then said node calls `readStart` in neither arrangement -- a
measurement whose hook was on the *instance*, installed after `spawn` had returned, while node
calls it during `spawn`. The third error is the one worth keeping, because it was a *plan*: it
proposed handing the descriptor instead of the stream and stopping the host's reader. That would
have broken `pipe-dataflow` again, and the two tests never wanted opposite handoffs at all.

The measurements that were right stay right. Hooking `Pipe.prototype.readStart` before any child
exists, for one `spawn`:

    readStart calls during spawn   2      (stdout and stderr)
    readableLength after a turn    65536

and hooking `readStop` across a handoff:

    before the handoff   isPaused=false destroyed=false
    after                isPaused=true  destroyed=false  readStop=1  handle=present
    later                readableLength=0

**node pauses the parent's reader and keeps the handle.** That was correct, and so was the reading
that the parent "can `resume()` afterwards". What the note never asked is **which object the
parent resumes**. Upstream it is one object, so `p1.stdout.resume()` reaches the socket. Here the
module's `resume()` reaches its own `ChildReadable`, whose `_read` arrives at
`nts_child_process_read_start` -- and that binding attached a `data` listener and stopped there.

`Readable.prototype.on("data")` resumes only when `state.flowing !== false`. A stream that has
merely never been read has `flowing === null` and starts; one that somebody *paused* has
`flowing === false` and stays put. node pauses this exact stream when it gives it to another child,
in `lib/internal/child_process.js`:

    if (stream.type === 'wrap') {
      stream.handle.reading = false;
      stream.handle.readStop();
      stream._stdio.pause();
      stream._stdio.readableFlowing = false;
      stream._stdio._readableState.reading = false;
      stream._stdio[kIsUsedAsStdio] = true;
      continue;
    }

So the host socket was parked and no listener was going to wake it. Two arms, one variable:

    one child, reader attached late            host `flowing=null`   delivers
    stdout handed over, reader attached late   host `flowing=false`  nothing, ever

**The fix is `stream.resume()` in `read_start`**, because `read_start` means start reading and
should say so rather than hope a listener implies it. `pipe-dataflow` is untouched: a stream marked
handed-over never reaches `read_start` at all, so nothing resumes it.

The trace that found it had already printed `flowing=null` against `flowing=false` two runs
earlier, next to six other fields, and I read past it. What finally separated the two was not a
better trace but **the arm without a handover** -- the upstream file has only the handover arm, and
with one arm "late reads are broken" and "handed-over streams are broken" are equally good
explanations. `test/late-read-local.js` is that pair, kept.

Also worth recording: three of the traces on the way here were **interventions**. A `console.error`
in `cluster`'s `#handoff` bought enough latency to make a failing race pass, and an `fs.readSync`
on the descriptor changed what the next read saw. Print-based tracing is not free on anything
timing-shaped.


