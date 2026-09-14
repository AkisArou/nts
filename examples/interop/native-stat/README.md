# native-stat

`struct stat`: 144 bytes, sixteen members, three of them a nested
`struct timespec`, several 64-bit, and a trailing inline array.

Nothing here is hand-written. `types/stat.d.ts` comes from `bind.sh`:

    sh examples/interop/native-stat/bind.sh

That is the point of choosing this struct. `struct pollfd` is three members and
a careful person gets it right; `struct stat` has a `__pad0` between `st_gid`
and `st_rdev` that exists for no reason a reader can infer, and getting it
wrong moves every offset after it. The first person to transcribe this by hand
would get it wrong, and the layout check would tell them so — which is worse
than not having to.

`struct timespec` is **not** in the command. It is stored inline in `stat`, so
its layout is part of `stat`'s, and the generator pulls it in rather than
demanding it.

## What checks it

`native/caller.c` creates a file of seventeen bytes — a number no padding or
off-by-one offset produces — calls `stat` itself through the real
`<sys/stat.h>`, and compares every value against what the compiled TypeScript
reports:

    stat: size=144 align=8, st_size at 48, st_mtim at 88, reserved at 120
    sizeOf = 17 (C says 17)
    modifiedSeconds = 1789430037 (C says 1789430037)
    linkCount = 1 (C says 1)

`st_mtim.tv_sec` is the arm that matters: 88 bytes in, past three 64-bit
members and two nested structs. An offset wrong by one member lands in
`st_ctim` or `st_blocks` and disagrees with C. Neither side holds a constant
from this repository.

`native_witness.c` asserts the whole layout against the real header, and
`program.c` includes that header rather than defining its own `struct stat`, so
its own `_Static_assert`s are the C compiler answering about the real type.

## Two things the command says that the header does not

`--no-escape stat:file` and `--no-escape stat:buf`: that `stat` reads the path
and writes the buffer during the call and keeps neither. A C signature cannot
state it, so it comes from an author. Without it the compiler refuses
`local<Stat>()` as an escape.

The parameter is `file`, not `path` — the names come from the header
(`__file`) with leading underscores stripped. Naming one that does not exist is
refused by `nts bind-c` with the list of ones that do, which is how this
example's first `bind.sh` was wrong.

## Build

    sh examples/interop/native-stat/build.sh
