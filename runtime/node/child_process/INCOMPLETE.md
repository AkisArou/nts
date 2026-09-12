# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    interpreted   119 file(s): 80 passed, 29 failed, 9 skipped, 1 not applicable
    compiled      119 file(s):  0 passed, 109 failed, 9 skipped, 1 not applicable

Measured with `run.mjs --module child_process`, not added up: the same batch read 80
on its first full run, because ten individual passes came with one regression.

114 by `test-pattern`, 4 claimed in `extra-tests`, 1 local fixture. Up from 42
passed of 114 when this session started, and from 1 passed when the branch was
parked. The denominator moved, so the gain is by name: 21 upstream files, plus 3 of
the 4 claims already passing.

**Measured on `main`, which is not the same number the branch gave.** The
`nodejs/child-process-wip` worktree reads 67 passed / 43 failed on byte-identical
module sources, because it is 136 commits behind: four files pass here and fail
there. Same lesson as the one below -- the tree is part of the number.

## What is left, by size

    25  fork and IPC        `fork` is the largest single block: the channel, handle
                            passing, advanced serialization, `process.send` in the
                            child, and disconnect. test-cluster-net-send.js is
                            claimed here and belongs to it.
     4  two named features  no longer "assorted" -- both are below, and neither is
                            a small fix

### A stream as a stdio entry -- three files

    pipe-dataflow.js                   stdio: [cat.stdout, 'pipe', 'pipe']
    stdio-merge-stdouts-into-cat.js    stdio: ['pipe', p3.stdin, 'inherit']
    stdio-reuse-readable-stdio.js      stdio: [p1.stdout, 'pipe', 'inherit']

The binding carries stdio as a **packed 6-bit mode** -- two bits per slot for
`'pipe'`, `'inherit'`, `'ignore'` -- so a descriptor cannot cross it at all. Passing
one child's stream as another's stdio needs the mode replaced by a per-slot
descriptor list and `UV_INHERIT_FD` in the C, which is a binding change rather than a
module one.

`pipe-dataflow` fails on `cat.stdout._handle` for the same reason and not a missing
property: it asserts the **parent never reads** a stream it handed to another child,
which is a thing this shape cannot express either way.

### `ChildProcess.prototype.spawn(options)` -- one file

    constructor.js

node's own bootstrap calls it on a bare `new ChildProcess()`, and
test-child-process-constructor asserts its argument validation. Exposing it means
publishing the internal spawn surface, which is a decision rather than an omission:
the class currently cannot exist without a handle.

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
