# 0008 — Why a string scan is nine times slower than V8

`strings` is the one benchmark nts loses to V8, and by a lot. This records what
it costs, what it is not, and the one thing standing in the way — which turns out
to be a fact about negative zero.

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

## The blocker: negative zero

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

That is a use analysis, not a range analysis, and it is the next thing worth
building for this benchmark. It would also help anywhere else a product or a
negation feeds an accumulator, which is most numeric code.

## What was kept

- `charCodeAt` as `StringUnitAt`, with `checked` meaning "may be NaN" rather than
  "may trap" — the reverse of an array's, because out of range is `NaN` here.
- Exact length for a string literal, in the facts and in the bounds proof.
- Bounds elimination before specialization as well as after.
- `nts_to_int32` without `fmod`.
- `memchr`/`memcmp` search for narrow strings.

None of these moved this benchmark. All of them are right, and three of them
will matter as soon as the sign-of-zero question is answered.
