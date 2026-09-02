# 0033 — A table rather than an algorithm

`toLowerCase` and `toUpperCase`, which were 39 of the 42 string refusal sites
left in the node profile and are the first vendored code in this repository.

## Why vendor at all

`typescript.md` had called these "data rather than code" for months, and that was
the right diagnosis and the reason nothing happened: the code is a hundred lines
and the tables are a Unicode release. Writing them by hand is not engineering,
and generating them is a build system nobody asked for.

quickjs-ng's `libunicode.c` is exactly that data, it is MIT, and it is
dependency-free C. The nts runtime *is* emitted C compiled by clang, so it drops
in with no build system at all. `runtime/c/quickjs/README.md` has the whole
argument, including why ICU is not the answer here and where it would be.

The first version of that argument said "ICU4X is Rust and does not fit", which
named the wrong reason — ICU4C exists and is C. The objection that survives is
deployment: C++ behind a C wrapper, a prebuilt library plus a data file, tens of
megabytes. Recorded because a rejection for the wrong reason is one somebody
re-litigates from the wrong premise.

## quickjs-ng rather than bellard/quickjs

Vendored from bellard's first and switched, and the difference is not
maintenance politics. quickjs-ng's `libunicode.c` needs nothing outside libc —
`nm -u` on the object shows `abort`, `memcpy`, `realloc`, `strlen` and no more.
Bellard's pulls `dbuf_*` and `rqsort` out of `cutils.c`, so vendoring it meant a
fifth file and a second body of code existing only to support a normalizer
nothing calls yet.

Same API, same `conv_type` convention, and the same binary cost to within 200
bytes. One thing it costs: its `cutils.h` is 54 KB rather than 11 KB and reaches
for `clock_gettime`, `readlink` and `pthread_condattr_setclock`, so a
`-std=c11` build fails on five undeclared names. The `_POSIX_C_SOURCE` that
fixes it lives in the emitter's prefix rather than in their source, so updating
upstream stays a file copy.

## What it costs, which decided the design

Linking libunicode into `examples/hello` takes it from **81 KB to 162 KB**.
Doubling every binary to carry tables most programs never read is not a tradeoff
worth making, so it is emitted only for a program that calls one of the methods
— the same way `nts_uv_host.c` is written only for a program that needs a loop.

## The audit, and why nothing was trimmed

90% of the library is unreachable from anything nts calls: of 20 KB of code and
43 KB of tables, `lre_case_conv` and ~3 KB of case tables are all that runs.

Every one of the others is used by `libregexp.c` — `cr_init`, `cr_free`,
`cr_invert`, `cr_regexp_canonicalize`, `lre_canonicalize`, `unicode_prop`,
`unicode_script`, `unicode_general_category`, `unicode_sequence_prop` are what
`\p{...}` and case-insensitive matching are made of — and `unicode_normalize` is
`String.prototype.normalize`. Regex is the next thing on the list at 47 refusal
sites. Deleting the dead 90% would be deleting exactly what the next two
features need.

The linker does it better anyway, and the numbers are the argument:

                              plain      -Wl,--gc-sections
        no Unicode           81,168             15,976
        case conversion     162,312             26,096
        Unicode costs        81,144             10,120

87% of the tables go with no fork at all, and the set adapts as more of the
library gets used. The same flags take a program with *no* Unicode from 81 KB to
16 KB, because most of the runtime is unreachable from any one program too —
which is a bigger result than the one this record set out to get, and is why
`nts emit-c --main` now prints them.

Measured wrongly the first time: with a `main` of `return 0`, `--gc-sections`
strips the whole program and the Unicode delta reads as 32 bytes. A size
measurement needs a program that calls something.

That decision costs something real: eight places compile a program, and each had
to learn about a second translation unit. `support_files` is the one list they
now share, and `Support::compiled` says which entries go on a command line, so
nothing matches on `.c` and nothing can disagree.

## Three wrong steps, in order

The conversion loop was rewritten three times and only the first change helped.

    two comparisons and a branch per byte      8.64 us
    a 256-byte lookup table                    6.66 us
    branchless arithmetic, no table            7.26 us

The arithmetic form was written on the theory that `table[bytes[at]]` is a
gather clang cannot vectorise, while comparisons and adds are sixteen bytes per
instruction. It measured **worse**. Blaming the `&&` short-circuit for being a
branch and rewriting it as `&` changed nothing at all — 7.26 either way.

What the theory missed: 256 bytes stays in L1, so the table is *one load* per
byte with no dependency chain, against two range tests, an or, a shift and an
add. At 44 bytes the instruction count decides and the vector width never gets
a chance.

Dropping the pre-scan — `nts_all_ascii` walked the string before converting it —
moved 6.74 to 6.66, which is nothing. That step was wrong too. It is still in
the code because it is *also* less work, but it is not why anything got faster.

## The step that actually mattered was not a code change

`case-convert` allocates 128 strings per iteration and I had not written its
`provider` file, so it ran under `NoGC`. Adding the file took it from 6.66 to
**4.79 us**.

`provider_for` in `tooling/bench` has said why since long before this: a case
that allocates per iteration must declare `rc`, or the row measures the
allocator running out of fresh memory rather than the code. I read that comment
after the measurement rather than before it.

## Where the time actually goes

Isolated in C, 200k calls on a 44-byte ASCII string:

    allocate + free, recycled (RC)      8.0 ns
    toLowerCase                        24.5 ns     -> conversion ~16.5 ns
    allocate, fresh memory (bump)      19.8 ns

Allocation is a third of the call. And the bump allocator — the one with no
bookkeeping — is **2.5x slower per allocation** than reference counting with
recycling.

Not page faults, which was the first guess: `MAP_POPULATE` moved the isolated
number only from 17.29 to 16.08 ns, and `memset` made it *worse* at 19.55. It is
cache. A bump allocator that never reuses writes into fresh DRAM forever, while
a recycling one hands back lines that are still hot.

That is a runtime-wide finding rather than a string one, and it is the largest
lever this record found. It is written down here and not acted on.

## The ratchets

- **correctness** — `examples/strings` gained six functions and node agrees with
  all of them: ASCII, Latin-1 (`ÿ`→`Ÿ`, `µ`→`Μ`), the mappings that grow
  (`ß`→`SS`, `ﬁ`→`FI`, `ǳ`→`Ǳ`), astral Deseret, Greek, Cyrillic, empty.
- **memory** — `tooling/memory/cases/case-convert`, at `ideal 18` and
  `allocated 17`. Argued as 17 and the instrument said 18: the first store
  overwrites an immortal `""`, which is free at run time and is still an emitted
  call, and this suite counts operations emitted. The argument was wrong by
  exactly the one I had talked myself out of.
- **speed** — `case-convert`: **4.80 us against node's 3.02 us**, and 0.79x the
  C++ reference.

## What is not done

**1.59x node is not a win**, and the mandate for this project is that it should
be. The conversion is ~16.5 ns for 44 bytes and the allocation is ~8 ns; V8 does
the whole thing in ~23 ns. Closing it means attacking the allocation, not the
loop — either by reusing the receiver's storage when it is uniquely owned and
dying, which is the machinery `nts_str_append` already has, or by the allocator
finding above.

`normalize` is not wired. The tables for it came along with the case tables —
`libunicode.h` defines `CONFIG_ALL_UNICODE` itself — so it is three refusal
sites and a signature away, and it is left because `unicode_normalize` needs
`dbuf` and an allocator argument that wants its own thought.

The **locale** forms are deliberately absent rather than aliased onto these.
`toLocaleUpperCase` of `i` in Turkish is `İ` and not `I`; answering it with the
locale-independent mapping would be wrong rather than approximate, and a wrong
answer is worse than a named refusal. That is the one thing ICU would be for.
