# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    interpreted   120 file(s): 101 passed, 9 failed, 9 skipped, 1 not applicable
    compiled      120 file(s):  0 passed, 110 failed, 9 skipped, 1 not applicable

114 by `test-pattern`, 4 claimed in `extra-tests`, 2 local fixtures. 1 passed when the
branch was parked, 42 when this work started.

Measured with `run.mjs --module child_process`, not added up: an earlier batch read 80
where ten individual passes had predicted 81, because one of them came with a
regression.

## What is left: 9 files, each with a cause

The IPC channel works -- fork, `send` each way, the child's `process.send`, `disconnect`,
exit 0, held by `local/ipc-roundtrip-local.js`. Handle passing works: a socket crosses to a
worker. What remains is nine files, and the causes are separated below into **diagnosed**
-- a mechanism was found and checked -- and **observed**, where only the failing assertion
is known. Calling the second kind a cause would be the thing this directory keeps warning
about.

### Diagnosed

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
    pipe-dataflow.js                      the parent must not read a stream it hands on
    stdio-reuse-readable-stdio.js         the same stream handed to a second child
    constructor.js                        `ChildProcess.prototype.spawn`

  `fork-stdio` wants `child.stdio[4]` -- a slot beyond the three plus the channel.
  `pipe-dataflow` and `stdio-reuse-readable-stdio` assert that the parent never reads a
  stream it handed to another child, and
  `ChildReadable` reads in its constructor, which `test-child-process-kill` requires so a
  killed child's stdout still reaches `end`; those two pull opposite ways and the answer is
  a decision about who owns the read, not a line of code. `constructor` wants node's
  internal spawn method on a bare `new ChildProcess()`, which means publishing the internal
  spawn surface.

### Observed, not diagnosed

    send-returns-boolean.js               the fourth of five `send`s never settles
    send-keep-open.js                     the child's exit assertion never runs
    test-cluster-net-send.js  (claimed)   a net handle over the channel, with cluster's
                                          worker half in play

  Each has a located assertion and no found mechanism. `send`'s callback *was* being
  dropped -- located by the argument shuffle and never invoked -- and fixing that moved
  neither, so whatever these are, it is not that. Written here as observations so the next
  person does not inherit a guess dressed as a cause.

## The three I called unfixable, which pass here

`exec-timeout-expire`, `exec-timeout-kill` and `exec-timeout-not-expired` are the
three files in this module that require `common/child_process`, whose line 5 is
`require('./')` -- node's real `common/index.js`, which walks
`for (const val in globalThis)` at exit and fails the file with
`Unexpected global(s) found`.

The `nts_*` half of that leak is fixed harness-side (`d265780c`). I then wrote that
the `atob`/`btoa` half **could not** be fixed on this lane, reasoning that node's
`common` takes them from `require('buffer')` and compares *identities*, that
`run-one.mjs` substitutes bare specifiers, and that `buffer` is in this module's
`uses` -- so `common` would hold our `atob` while `globalThis.atob` was node's, and
no implementation makes those the same object.

**All three pass on `main`.** The reasoning was sound and the conclusion was drawn
from the wrong tree: `buffer/shape.mjs` has an `installGlobals` that sets
`globalThis.atob = underTest.atob`, and `run-one.mjs:631` calls it for siblings as
well as for the module under test, so the identity can hold. Both trees have that
mechanism; only the branch fails, and it is 136 commits behind.

So this is not a labelled blocker. It is a claim of unfixability made from one tree
and refuted by the other, left here because the next person to see
`Unexpected global(s) found: atob, btoa` on a branch should know it is a stale
checkout rather than a wall.

## Two things found while writing it, both worth keeping

**`on_exit` is libc's.** A `static void on_exit(...)` in `child_process.c` is a
redeclaration of `on_exit(3)` from `<stdlib.h>` with a different type, and clang
says so. Renamed to `on_sync_exit`.

**`validateArray` widens.** `Array.isArray(args)` narrows to `readonly string[]`;
`validateArray(args, "args")` asserts `unknown[]` and therefore widens it back, so
slicing the asserted binding is `unknown[]` and TS2322. The interpreted lane never
saw it, because it does not typecheck.

## What the compiled lane says, and the hollow pass it was hiding

**0 passed, 109 failed.** Against 80 on the interpreted lane, on the same corpus and
the same source -- the shape `stream` already shows at 252/0 against 1/251, and the
reason the goal text calls the compiled lane the axis.

The compiled lane first read **1 passed**, and `--sabotage` said that pass was hollow:
emptying the module left the count at 1 on both lanes. The file is
`test-child-process-fork-closed-channel-segfault.js`, its subject is `cluster`, and
because `cluster` is not in this module's `uses` the runner hands it node's own -- so
it forks through node's cluster, never reaches this module, and asserts the absence of
a segfault, which an absent module satisfies for free. It is in `not-applicable` now
with that reason.

Removing it takes the interpreted lane from 81 to 80 and the compiled lane from 1 to
0. Both are the honest direction, and the second is the point: **the compiled lane has
no non-hollow pass in this module at all**, and the 1 it reported was this file.

So the compiled axis is unchanged by adding this module -- 49 across 25 modules rather
than 24. The earlier note in the ledger asking whoever quotes the axis to add this
module has its answer: it adds nothing.
