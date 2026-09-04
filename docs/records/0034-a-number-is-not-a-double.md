# 0034 — A number is not a double, and the benchmark was measuring V8 skipping work

`String(x)` was the slowest thing in the runtime and nothing measured it.

## What it was

`nts_shortest_digits` found the shortest round-tripping decimal by asking the C
library, repeatedly:

```c
for (int precision = 1; precision <= 17; precision++) {
    snprintf(buffer, sizeof buffer, "%.*e", precision - 1, x);
    if (strtod(buffer, NULL) == x) { ... }
}
```

Correct, and correct *by verification*, which is the reason it survived: it
cannot be subtly wrong. It could only be slow, and it was — 867ns to render
`1234567`, because seven digits mean seven `snprintf` calls and seven `strtod`
calls. Every template literal, every `"" + n`, every `join` on numbers.

quickjs-ng's `js_dtoa` computes it. Byte-identical output on every value tested,
and node agrees on the edges — `±0`, `±Infinity`, `NaN`, the exponent thresholds
at 1e21 and 1e-7, the denormal minimum, the maximum double, `0.1 + 0.2`. Those
are `examples/arith`'s `numberToStringEdges` now, because the implementation
changed underneath them and the swap needed an oracle rather than a claim.

## Three findings, of which two were mine being wrong

**The row did not exist.** A 56× improvement moved the benchmark table by noise,
because not one case formatted a number in its hot path. A win nothing measures
is a win nobody can defend, so `number-format` exists now.

**The integer fast path was not the fix.** `js_dtoa` is the general double
algorithm and V8 splits integers out, so `i32toa` went in front of it — and the
row moved 4%. That step was wrong and the probe said so:

    i32toa alone            7.44 ns
    ..._into(frame)         9.48 ns
    ..._into(NULL) = heap  14.34 ns

The conversion *was* the cost, and quickjs-ng's `u32toa` is a divide-by-ten loop
into a scratch buffer followed by a `memcpy`. Two digits at a time from a table,
with the length known from `nts_digits10` before the first digit is written and
the digits going straight into the string, took the whole call from 9.48ns to
about 5. That code is in `nts_runtime.c`, not in `runtime/c/quickjs`: their tree
stays unmodified so updating it is a file copy.

**The benchmark was measuring V8 eliding the string.** `number-format` reported
3.03× node, then 2.52× when it read the first character instead of only the
length. Summing every character:

                     C++       nts     node      bun
    number-format   840 ns   988 ns   1.41 us   827 ns    0.70x node

node went from 652ns to 1.41us the moment the characters had to exist. The row
was measuring V8's ability to compute a digit count without building a string,
and the "loss" I reported twice was a phantom. `String(n).length` is not a
measurement of `String`.

## Where the allocation went

`String(x)` is the one string-producing helper whose output length is known
*before* it runs: seventeen significant digits at most, so twenty-four
characters at most. A bound the compiler knows is a bound it can put in a frame,
so `frame_capacity` gives the call forty units and `nts_number_to_string_into`
writes into it. `tooling/memory/cases/number-to-string` is at **ideal 0,
allocated 0**.

That is the whole difference from `toLowerCase`, whose case
(`tooling/memory/cases/case-convert`) argues seventeen allocations are
necessary: a converted string's length is its input's, and no compile-time bound
exists. One primitive, two helpers, two different floors, and the reason is a
property of the operation rather than of the compiler.

## And then the doubles

`number-format-double` said **1.28x node**, and `js_dtoa` is why: bignum
arithmetic -- `mpb_t`, `limb_t` -- exact by construction and therefore
unconditionally slow. 83ns to print `0.009765625`, 120ns for pi.

Grisu3 does the same work in fixed 64/128-bit arithmetic. It is in
`runtime/c/nts_grisu.h` as nts's own code, with `js_dtoa` kept as the fallback,
so `runtime/c/quickjs` stays unmodified and updating it is still a file copy.

    0.009765625        83.1 ns -> 15.2 ns   5.5x
    pi                120.0 ns -> 24.4 ns   4.9x
    1/7               82.9 ns -> 24.3 ns    3.4x

    number-format-double     11.37 us -> 4.60 us     1.27x node -> 0.51x node

**A fallback only protects you if the algorithm cannot be wrong.** Grisu3's
weeding step accepts a digit string only when it can show the string reads back,
so it can decline but not lie -- which is what makes "fall back to the exact one"
a proof rather than a hope.

Asserted before it shipped, and not against node: 4,166,499 doubles -- random
bit patterns, values programs actually print, every edge worth naming -- checked
against `js_dtoa` character for character *and* round-tripped through `strtod`.
Zero disagreements, zero failed round trips, 0.220% declined.

That harness earned itself immediately. Three transcription errors against the
reference algorithm, none of which a casual test would have found:

- the cached-power index was missing its `+ kQ - 1` term, which printed `0.1` as
  `1844674407370955300` -- the unscaled significand, `2^64/10`;
- the lower boundary was treated as closer for denormals, which it is not;
- `one` was built from the boundary's exponent rather than `w`'s.

The 88-entry table of cached powers was **generated** with exact integer
arithmetic rather than transcribed. A mistyped constant there is a wrong answer
for one value in a billion, and nothing in this repository would have noticed.

## What is left

`toFixed`, `toPrecision`, `toExponential`, `parseFloat` and `parseInt` are
`js_dtoa`'s `FORMAT_FIXED`/`FORMAT_FRAC` with the `EXP_*` flags and `js_atod` --
all vendored, all compiled in, none reachable from a program. They are wiring
rather than algorithms now.

## `node-utf8`, and three diagnoses that were all wrong

The last row behind node, at 1.31x, and I do not know why.

What it is **not**, each refuted by a measurement rather than by argument:

- **Not cons strings.** The hypothesis on record was that V8 answers `.length`
  from an unflattened rope. `utf8Write` builds no string at all and is also
  behind, at 1.06x on the C backend.
- **Not the append path.** Splitting the decoder in two: with the string
  building it is 1.24x node, and with the string building *removed* it is
  1.30x. Taking the strings out makes the ratio worse, so the string work is
  the better half of that program.
- **Not the loop counter's representation.** The prepared HIR showed
  `decodeCounting(bytes, start: i32, end: f64)` with the counter at `f64`, so
  every `i++` was a floating-point add. That was true, it was a real defect
  (below), fixing it made the counter an `i32` -- and the benchmark did not
  move at all.

Three hypotheses, three refutations. The honest state is that only the
eliminations are known. A fourth guess without a profiler would be a fourth
hypothesis, and this machine has neither `perf` nor `valgrind`.

One thing worth recording against a future attempt: a hand-written C decoder
using the same runtime measured **106us per 64 decodes against the generated
code's 32**, because it reached for `nts_string_from_char_code` and
`nts_str_append` where the compiler emits frame-placed storage. The generated
code is not naive; whatever the gap is, it is not that.

## The defect that fix found, which bought nothing

`specialize::width_of` returned `None` for any value that is not a `Float` --
including a parameter `signatures` had just narrowed to `i32`. A class is only
as good as its worst member, so **the most integral value in a function was the
one sinking its class to a double**.

It fires exactly when a loop counter starts from a parameter:

    for (let i = 0; i < end; i++)          the counter is an i32
    for (let i = start; i < end; i++)      the counter is an f64

which is every scanning function that takes an offset. The counter entered the
loop through a `convert`, was converted back at the comparison, and incremented
in floating point.

The module already had this reasoning for *comparisons* -- "joining to a
parameter can only drag the other side down with it" -- and the edge union
simply lacked the same guard. An already-integer member now contributes its
width instead of `None`, and `pinned_widths` refuses any class that would need a
different type, so a parameter's ABI cannot be rewritten underneath it.

**Measured: essentially nothing.** On `node-utf8`, conversions 100 -> 98 and
double locals 333 -> 327 -- six values out of 533. Wall clock across
`node-utf8`, `bytes`, `checksum`, `elementwise`, `awfy-sieve`, `accumulate` and
`fib`: unchanged within noise.

Kept anyway, and the distinction matters: the rule it replaces was *wrong*, not
merely unprofitable. `0027` deleted a pass that made the analysis worse; this
one makes it correct and the benchmarks do not care. Presenting it as the fix
for `node-utf8` would have been the failure this record exists to avoid.
