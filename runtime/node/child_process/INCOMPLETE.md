# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    interpreted   120 file(s): 84 passed, 26 failed, 9 skipped, 1 not applicable
    compiled      120 file(s):  0 passed, 110 failed, 9 skipped, 1 not applicable

114 by `test-pattern`, 4 claimed in `extra-tests`, 2 local fixtures. 1 passed when the
branch was parked, 42 when this work started.

Measured with `run.mjs --module child_process`, not added up: an earlier batch read 80
where ten individual passes had predicted 81, because one of them came with a
regression.

## What is left: 26 files under seven named causes

The IPC channel itself **works** -- fork, `send` each way, the child's `process.send`,
`disconnect`, exit 0, held by `local/ipc-roundtrip-local.js`. So none of these is "fork
is broken"; each is a feature on top of a channel that carries messages.

     8  handle passing over the channel     recv-handle, send-returns-boolean, fork-net,
                                            fork-dgram, fork-getconnections,
                                            cluster-net-send and two more. `send`'s
                                            second argument is currently **rejected**
                                            with ERR_INVALID_HANDLE_TYPE rather than
                                            ignored, which is what node raises for a
                                            thing that cannot be sent and is true of
                                            all of them here.
     7  channel lifecycle                  disconnect, send-after-close, send-keep-open,
                                            internal, fork-ref2, fork-abort-signal,
                                            fork-timeout-kill-signal
     5  a channel on spawn, not only fork  advanced-serialization x4, stdout-ipc.
                                            `send` is assigned in `fork`'s body, so a
                                            child from `spawn(.., { stdio: [.., 'ipc'] })`
                                            has none, and the spawn binding makes no
                                            channel. `advanced` serialization is also
                                            unimplemented -- accepting the name and
                                            using JSON would be the wrong half to get
                                            right, so `validateSerialization` accepts it
                                            and nothing else pretends.
     3  a stream as a stdio entry          pipe-dataflow, stdio-merge-stdouts-into-cat,
                                            stdio-reuse-readable-stdio. The binding
                                            carries stdio as a packed 6-bit mode, so a
                                            descriptor cannot cross it.
     1  extra stdio slots beyond three     fork-stdio wants `child.stdio[4]`
     1  ChildProcess.prototype.spawn       constructor
     1  a file URL for modulePath          fork-url.mjs

Four of the seven are the same shape: the binding's stdio is three slots and one flag
where node's is an array. That is one change, not four, and it is the largest single
item left in this module.

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
