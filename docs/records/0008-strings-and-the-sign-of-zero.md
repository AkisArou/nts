# 0008 — A string scan, and the sign of a zero

`strings` was the one benchmark nts lost to V8, by nine times. It now beats V8 by
five and is within a factor of two of hand-written C++. This records what the
cost turned out to be, the three plausible causes that were not it, and the one
that was — which is a fact about negative zero.

## The numbers

| | ns |
| --- | ---: |
| hand-written C++ | 580 |
| nts | 28,400 |
| node 24 | 3,050 |

Bisecting the workload separates two halves cleanly:

| | nts | node | C++ |
| --- | ---: | ---: | ---: |
| the `charCodeAt` loop alone | 27.0 us | 3.04 us | 414 ns |
| the three searches alone | 619 ns | 89 ns | 348 ns |

The searches are not the problem. The scan is all of it.

## Three things it is not

Each was plausible, was tried, and did nothing:

- **The call overhead of `charCodeAt`.** Moving it and `nts_unit` into the header
  as `static inline`: no change.
- **`fmod` in `nts_to_int32`.** The old implementation reduced modulo 2^32 with a
  library call for any value outside `int32`. Replaced with exponent arithmetic —
  ten instructions, no call: no change. (Kept anyway; it is unambiguously
  better, and `x | 0` after any real arithmetic is usually out of range.)
- **The naive substring search.** `nts_str_find` compared a code unit at a time
  through a function that had to ask which width the string was. Replaced with
  `memchr`/`memcmp` for the narrow case: no change to this benchmark, because the
  searches were never the cost. (Kept, for the same reason.)

## What it is

A loop-carried dependency through floating point.

```c
v17 = nts_unit(v1, (uint32_t)v14);   /* the code unit, as a double */
v55 = (double)v3;                    /* int -> double  */
v18 = v17 * v55;
v56 = (double)v13;                   /* int -> double  */
v19 = v56 + v18;
v21 = nts_to_int32(v19);             /* double -> int  */
```

`total` leaves the loop as an `int32`, becomes a double, and comes back. That
round trip is `cvtsi2sd` + `addsd` + `cvttsd2si` — about fourteen cycles of
*dependency*, which at 3 GHz is the 4.9 ns each character costs. C++ keeps the
accumulator in a register the whole way and spends two.

Everything needed to avoid it is already proven. Four steps got most of the way:

1. `charCodeAt` became an operation rather than a call. As a call, its index had
   to match a C signature, which pinned the index — and the loop counter that
   produces it — to a double.
2. A string literal's length is exact, so `i < text.length` compares against a
   constant.
3. Bounds elimination proves the index inside the string, which makes the read
   `unchecked` — and an unchecked read cannot be `NaN`.
4. Bounds elimination moved to *before* specialization, because proving an access
   safe sharpens the facts rather than merely removing a test. Running it
   afterwards was too late for the type to change.

After all four, the index and the counter are `i32` and the read is unchecked.
The arithmetic is still floating point.

## The blocker: negative zero — and the fix

```
%17  f64  [0, 65535] whole
%18  f64  [-140735340871680, 140735340806145] whole -0?
%19  f64  [-140737488355328, 140737488289792] whole
```

`%18` is `codeUnit * step`. The analysis says it may be a negative zero, and it
is right: `0 * -5` is `-0`. `is_integral_within` refuses a value that may be one,
and it is right too — `1 / -0` is `-Infinity` and `1 / 0` is `+Infinity`, so
representing `-0` as an integer loses something observable.

But look at `%19`: adding anything to `-0` gives that thing back, so the sign
does not survive one line later. Nothing in this program can observe it.

So the fix is not to relax the rule. It is to ask a question the compiler does
not currently ask: **does anything downstream observe the sign of this zero?**
Division, `Object.is`, and conversion to a string are the ways it can be seen.
Where none of them is reachable from a value, a `-0` and a `+0` are the same
number and the value can be an integer.

That is a use analysis, not a range analysis, and `hir::zero_sign` is it. It runs
backward from the four places that can distinguish the two zeros — division by
the value, `Math.min`/`Math.max`, leaving the function, and arithmetic that
carries a zero's sign into something already observed — and marks what they
reach. Everything else may be an integer.

With it, the chain becomes `i64` end to end:

| | ns | against C++ | against node |
| --- | ---: | ---: | ---: |
| before | 28,500 | 48.3x | 9.1x |
| after | **1,100** | **1.96x** | **0.21x** |

Twenty-five times faster, and from nine times slower than V8 to nearly five times
faster.

The risk in a change like this is not a crash. It is `+Infinity` where the
program said `-Infinity`, in a corner nobody tests. What makes it believable is
that `nts check` runs `examples/negative-zero` — every way the sign can escape,
including across a loop-carried accumulator — against node over a pool containing
both zeros, and that all 29 examples, the end-to-end suite and the test262 slice
agree afterwards.

## What was kept from the false starts

- `nts_to_int32` without `fmod`. `x | 0` after any real arithmetic is usually
  outside `int32`, and that path was a library call.
- `memchr`/`memcmp` search for narrow strings, which most strings are.
- `charCodeAt` and `nts_unit` inline in the header.

None of the three moved this benchmark. All three are right anyway, and the first
two matter for programs shaped differently from this one.

## What is left

`nts/C++` is 1.96x. The remaining gap is that the C++ text is a `constexpr
string_view`, so clang can and does fold parts of the scan at compile time
against a string it knows. nts treats the literal as a runtime object. Whether
that is worth closing is a separate question from whether the code is good —
V8 does not fold it either, and nts is now five times faster than V8.
