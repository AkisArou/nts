# Żmij, vendored

The shortest correctly rounded decimal form of a `double`: the digits behind
`String(n)`, `n.toString()`, templates, `+` and JSON's numbers, through
`nts_number_digits` in `nts_runtime.c`.

    zmij.c      the C implementation, `zmij_detail_write` and its tables
    zmij-c.h    the C entry points
    LICENSE     MIT, Victor Zverovich; theirs, and it stays

From <https://github.com/vitaut/zmij>, unmodified. `REVISION` records the
commit. Updating it is a file copy of those two files and a new `REVISION`.

## How it is built

`nts_runtime.c` includes `zmij/zmij.c`, as it includes `quickjs/dtoa.c`, so it
travels in the runtime's one translation unit to every build. zmij spells
GNU's `asm` under `__GNUC__`, which `-std=c11` does not have, so the include
is wrapped in `#define asm __asm__` / `#undef asm` there rather than editing
this tree.

## Why zmij

Shortest round-trip, correct rounding, formally verified in Lean, and fast: it
replaced nts's own Grisu3 and the bignum `js_dtoa` it fell back to. zmij
writes Python-style text (`1e+21`, `1e-07`, `0.1`) and keeps its decimal
significand and exponent internal, so `nts_number_digits` reads the digits and
the exponent back from that text before ECMAScript's layout places them.
