# ffc.h, vendored

Decimal text to the nearest `double`: the value behind `Number(s)`, `+s` and
`parseFloat(s)`, through `nts_decimal_value` in `nts_runtime.c`.

    ffc.h           the single-header C99 port of fast_float, as upstream
                    amalgamates it
    LICENSE-*       Apache-2.0, MIT and Boost, theirs (the same three as
                    fast_float's), and they stay

From <https://github.com/kolemannix/ffc.h>, unmodified. `REVISION` records the
commit. Updating it is a copy of `ffc.h` and a new `REVISION`.

## How it is built

`nts_runtime.c` includes it once with `FFC_IMPL`, inside the block that holds
vendored code to its own warning standard, so it travels in the runtime's one
translation unit to every build, as `zmij/` does. `FFC_ROUNDS_TO_NEAREST`
drops the run-time check of the rounding mode, which the runtime never
changes.

## How it is used

The runtime checks JavaScript's grammar itself (`nts_number_span_is_decimal`,
`nts_parse_float`'s prefix) and hands ffc only a span it has admitted, with
`FFC_PRESET_GENERAL | FFC_FORMAT_FLAG_NO_INFNAN |
FFC_FORMAT_FLAG_ALLOW_LEADING_PLUS`. Its answer counts only when it read the
whole span; out of range is still an answer (±Infinity, ±0), as the
specification asks.

## Why ffc

Exact -- Eisel-Lemire, with fast_float's own slow path for what that cannot
decide -- and independent of the C library's locale, which `strtod` was not.
fast_float's README recommends it for C, and valkey and hiredis use it. It
replaced glibc's `strtod`: `str-to-number` went from 9.40 to 2.99 us on C (9.19
to 3.10 on LLVM). `runtime/c/tests/number_parse.c` checks it bit for bit
against `strtod` over every way a program writes a number.
