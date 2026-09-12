# `child_process`, part-built and in the profile

On `main` and counted, with 43 files failing. That is deliberate rather than
overlooked: every other module in this profile carries failing files on the
interpreted lane -- `async_hooks` 35, `fs` 12, `dgram` 2, `http` 1, `process` 1 --
and holding this one to 0 would be a standard the profile does not apply to itself.
What is not deliberate is a failure nobody wrote down, so they are all below.

## Where it is

    119 file(s): 71 passed, 39 failed, 9 skipped, 0 not applicable

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
    14  the rest            enumerated below, because "assorted" is how a list stops
                            being read

### The fourteen, each with what it actually wants

    constructor.js                     the `ChildProcess.spawn(options)` method, which
                                       node's own bootstrap uses and we do not expose
    stdio.js                           ERR_IPC_ONE_PIPE: two `'ipc'` entries in stdio
                                       must throw, and `stdioMode` ignores `'ipc'`
                                       entirely -- the error class is not in
                                       internal/errors.ts either
    stdio-merge-stdouts-into-cat.js    passing one child's stdout as another's stdio
    stdio-reuse-readable-stdio.js      the same, reusing a readable
    pipe-dataflow.js                   `readStart` on an undefined handle
    spawn-shell.js                     a `length` read on undefined
    spawnsync-input.js                 a Buffer half the expected length
    env.js                             an env assertion; unexamined
    exec-stdout-stderr-data-string.js  unexamined
    execfile.js                        unexamined
    prototype-tampering.mjs            unexamined
    spawn-error.js                     unexamined
    stdin.js                           unexamined
    uid-gid.js                         a missing exception; unexamined

"Unexamined" means exactly that: the message was read and the cause was not chased.
It is not a claim that the cause is small. Seven of the fourteen have a named want
because they were looked at; the other seven do not.

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

## What the compiled lane says

Not measured for this module. `compiled-axis.sh` covers the 24 modules that were in
the profile before this one; the axis was 49 files there, of which `tty` and `dns`
contributed one each as new modules. Adding this module to that measurement is the
next thing anyone quoting the axis should do.
