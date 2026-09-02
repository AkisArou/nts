# quickjs-ng, vendored

Unicode **case mapping** and **normalization**: the two things `typescript.md`
called "data rather than code", which is exactly right — the code is a hundred
lines and the tables are a Unicode release.

    libunicode.c        lre_case_conv, unicode_normalize
    libunicode-table.h  the generated tables, which are the bulk
    libunicode.h        the entry points
    cutils.h            macros and inline helpers the above compiles against

From <https://github.com/quickjs-ng/quickjs>, MIT, unmodified. `REVISION`
records the commit; `LICENSE` is theirs and stays.

## quickjs-ng and not bellard/quickjs

The maintained fork, and materially better here: its `libunicode.c` needs
nothing outside libc. Bellard's pulls `dbuf_*` and `rqsort` out of `cutils.c`,
so vendoring it meant a fifth file and a second translation unit's worth of code
that exists only to support a normalizer nothing calls yet. `nm -u` on the
compiled object is the whole argument — `abort`, `memcpy`, `realloc`, `strlen`,
and nothing else.

## Why here and not `third_party/`

This *is* runtime source: it is emitted beside `nts_runtime.c` and compiled into
the program by the same clang invocation, which is not true of anything else in
the tree. A subdirectory rather than loose in `runtime/c/` because the gate's
`format` step runs `clang-format --style=file` over `runtime/c/*.c` and
`runtime/c/*.h` and requires a match — vendored code is held to upstream's
formatting, not ours, and the glob does not descend.

## Why not ICU

ICU4C is the reference implementation and would be the right answer for
genuinely locale-sensitive behaviour — `localeCompare`, Turkish dotless-i
casing. It is not the right answer here: its core is C++ behind a C wrapper, so
every compiled program would pull in libstdc++, and it is a prebuilt library
plus a data file rather than source to vendor. The nts runtime is C emitted next
to the program and compiled by clang, and these files drop into that model with
no build system at all.

ICU4X was considered first and rejected for a reason that was wrong as stated —
"it is Rust" — when the real objection is the same deployment one, and applies
to ICU4C unchanged. Recorded so the next person does not re-litigate it from the
wrong premise. `localeCompare` has **0** refusal sites in the node profile, so
nothing is waiting on that decision today.

## Why it is not linked into every program

Measured: linking this into `examples/hello` takes it from 81 KB to 162 KB.
Doubling a hello-world to carry tables it never reads is not a tradeoff worth
making, so it is emitted only for a program that calls a method needing it — the
same way `nts_uv_host.c` is emitted only for a program that needs a loop.

## What we use, and why the rest stays

Audited, because 90% of it is unreachable from anything nts calls today:

    .text   20,181 bytes        .rodata   42,707 bytes

    lre_case_conv                used      case_conv tables, ~3 KB
    unicode_normalize            not yet   decomp/comp tables, 15.6 KB
    unicode_script               no        script tables, 6.9 KB
    unicode_general_category     no        unicode_gc_table, 4.1 KB
    unicode_prop, ..._sequence   no        prop + emoji-ZWJ tables, ~6 KB
    cr_* (ten functions)         no        char-range operations
    lre_is_id_start, ...         no        lexer helpers

**Nothing here is safe to delete.** Every symbol in that "no" column is used by
`libregexp.c`, which is the next thing on the list and 47 refusal sites:
`cr_init`, `cr_free`, `cr_invert`, `cr_regexp_canonicalize`, `lre_canonicalize`,
`unicode_prop`, `unicode_script`, `unicode_general_category` and
`unicode_sequence_prop` are what `\p{...}` and case-insensitive matching are
made of. `unicode_normalize` is `String.prototype.normalize`, three more sites.
Trimming would be deleting exactly what the next two features need.

The linker is the right tool for this instead, and it is very good at it.
Measured on a program that converts case:

                          plain      -Wl,--gc-sections
    no Unicode           81,168             15,976
    case conversion     162,312             26,096
    Unicode costs        81,144             10,120

87% of the tables go, without a fork, and the set adapts on its own as more of
the library gets used. The same flags take a program with no Unicode at all from
81 KB to 16 KB, because most of the *runtime* is unreachable from any one
program too -- so `nts emit-c --main` prints them.

## What is modified

Nothing, in these files. `libunicode.c` needs `_POSIX_C_SOURCE` because
quickjs-ng's `cutils.h` reaches for `clock_gettime`, `readlink` and
`pthread_condattr_setclock`, and that `#define` lives in the *emitter's* prefix
(`UNICODE_SOURCE` in `compiler/codegen/c/src/emit.rs`) rather than in their
source. Updating upstream stays a file copy.

Replacing `cutils.h` with a shim was considered and measured away: `libunicode.c`
takes nine identifiers from it -- `countof`, `max_int`, `likely`, the `DynBuf`
type with `dbuf_error` and `dbuf_claim`, and `rqsort` -- and the last three are
implementations rather than macros, so a shim would be a copy to maintain. The
whole translation unit compiles in 0.25s against `nts_runtime.c`'s 0.40s, for
the programs that need it at all. There is nothing to buy.
