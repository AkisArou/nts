# 0017 — The oracle has to be the specification, not the other implementation

Every differential in this repository compares bit patterns. `nts check` runs a
compiled function and node's copy of the same function over a pool of doubles
and requires the sixteen hex digits to match, and that severity is why it has
found what it has found: `Math.round`, `-0`, `>>>`, ECMAScript's
`Number::toString`, the typed-array store conversions. Every one of those bugs
produced an answer that was close enough to look right and was not right.

Adding the rest of `Math` broke that rule, and the interesting part is that it
was right to break it.

## What the measurement said

The first run of `examples/math` disagreed on 20 of 551 cases. Every
disagreement was one unit in the last place:

```
nts  logs 5 4012301e40b6bbf9
node logs 5 4012301e40b6bbf8
```

The usual reading — the flattering one — is that the instrument is broken. It
was not. The second reading is that the compiler has a bug. It did not. glibc's
`log` and V8's `log` are different functions, and both are conforming
JavaScript.

## What the specification actually says

ECMAScript divides `Math` in two, and the division is explicit in the text.
`abs`, `sign`, `floor`, `ceil`, `trunc`, `round`, `sqrt`, `fround`, `min`,
`max` and the eight named constants each have exactly one correct answer for
every input; the specification gives it. The rest — `pow`, the logarithms, the
exponentials, the trigonometric and hyperbolic families, `atan2`, `hypot`,
`cbrt` — are **implementation-approximated**. The specification names the
mathematical function, pins every special case (`pow(±1, ±∞)` is NaN;
`atan2(+0, -0)` is π), and leaves the rest to the implementation. It
*recommends* fdlibm. It does not require it.

So bit-equality with node was never the right oracle for those. It was a proxy
for one, and the proxy held only for as long as no program called `Math.log`.

## How far apart the two actually are

Worth measuring rather than assuming, because "1 ULP" is a claim about a
particular libm build and not about the language. Sixteen unary functions and
three binary ones, over a pool built to reach the awkward cases — signed zeros,
subnormals, 1e300, values just below 1, multiples of π:

| function | worst | where |
| --- | --- | --- |
| `cbrt` | 2 ULP | `cbrt(123456.789)` |
| `hypot` | 2 ULP | `hypot(123456.789, 6.283185307179586)` |
| `log`, `cos`, `tan`, `atan`, `sinh`, `cosh`, `atan2`, `pow` | 1 ULP | |
| `log2`, `log10`, `log1p`, `exp`, `expm1`, `sin`, `asin`, `acos`, `tanh` | 0 | over this pool |

`pow` is the one that matters, because `pow` is the one that looked safe: 551
differential cases had already agreed on it. Widening the pool found
`Math.pow(0.9999999999999999, 0.5)`, which is exactly `1` under glibc and the
next double below it under V8. **A pool that agrees is not a proof.**

## What was built

Three things, and the order is the point.

**The classification lives with the runtime.** `hir::builtin::APPROXIMATED`
names the helpers whose results the specification leaves approximate. It sits
next to the helpers themselves rather than in the test harness, because a helper
added to one list and not the other is a helper whose oracle is wrong — and
that failure is silent in the direction that matters.

**The property is transitive.** `builtin::approximating` takes a fixpoint over
the call graph: a function that returns `helper(x)` is as approximate as
`helper`. Call edges only. A value that reaches a *branch* rather than a result
can diverge by any amount at all, and no tolerance is the right answer for that
— it surfaces as an ordinary disagreement, which is exactly what it is.

**The tolerance is 4 ULP, and it is reported.** Four rather than the two that
were measured, because the bound being tested is "two conforming
implementations", not "this glibc". And `nts check` prints how many cases used
it:

```
checked 609 cases across 15 function(s)
20 case(s) matched only to within 4 ULP, in functions whose result the
specification leaves implementation-approximated -- glibc and V8 are both right
there
agreed on every case
```

A tolerance nobody can see is a tolerance nobody can tell has grown. 20 of 609
is a number a reader can be suspicious of; a silent `abs(a - b) < eps` is not.

## Whether the tolerance hides bugs

The only question that matters about a loosened oracle, and it has an answer
rather than an argument. Three sabotages, each a defect someone could plausibly
introduce:

| sabotage | caught |
| --- | --- |
| `atan2`'s arguments swapped | yes — π/2 against 0 |
| `Math.sign(-0)` returning `+0` | yes — `sign` is exactly specified, so it is compared exactly |
| `nts_math_pow` reduced to plain C `pow` | **no** |

The third is the one worth having done this for. `nts_math_pow` exists *only*
for the `pow(±1, ±∞)` rule; dropping the rule changed nothing, because the
driver's pool holds 1 and -1 but no infinity. The rule the helper exists for was
never executed. It is not that the tolerance hid it — the tolerance never saw
it — but the effect on a reader is identical: a green run that means less than
it appears to.

The fix is not a wider pool. It is a case in the example that reaches the rule
the way a program reaches it:

```ts
export function overflowingExponent(base: number, exponent: number): number {
  return base ** (exponent * 1e308);
}
```

Nothing there writes `Infinity`. `exponent * 1e308` overflows to one for any
exponent past about 1.8, which is how an infinite exponent arrives in real
source. With that in place the third sabotage fails loudly — `1` against `nan`
— and all three are caught.

## The same hole, three more times

`Number`'s predicates went in straight after, and they are the opposite case —
every one of them is exactly specified, so the oracle stays bit-exact and there
is no tolerance anywhere near them. They still had the *other* problem, twice:

- `isFinite` and `Number.isFinite` exist for infinity, and the driver's pool has
  no infinity. Deleting the check from `nts_is_integer` — so that it called an
  infinity whole — changed nothing.
- `Number.isSafeInteger`'s whole question is the boundary at 2^53, and the pool
  holds 2^53 - 1 and stops. Widening the bound by one representable value
  changed nothing.

Both were fixed the same way as `pow`: not by widening the pool, but by writing
the case that reaches the rule from a value the pool does have. `x * 1e308`
overflows to an infinity, and `Number.MAX_SAFE_INTEGER + 1` is exactly 2^53.
With those in the example, deleting either rule fails loudly.

So the discipline is not "sabotage the code and see if the tests catch it" as an
occasional exercise. It is: **for each rule you wrote, ask which case executes
it, and if the answer is none, that is the case to add.** Three of the four
rules written across this pair of features had no case reaching them, in a
project where every feature ships with a differential. The differential was
green all three times.

## What this does not license

The tolerance applies to nineteen named helpers and to nothing else. Every other
comparison in `nts check` is still bit-exact, including `sign`, `fround`, the
constants, and every special case of `pow` — because an infinity is not *near*
anything, so `ulps_apart` refuses to compare one and the exact path takes over.

The generalisation to resist is "floating point is approximate, so compare
loosely". It is not. `0.1 + 0.2` has exactly one right answer and this compiler
must produce it. What is approximate is a specific, enumerated set of library
functions, and it is approximate because a standards body wrote that down.

## The route not taken

V8 uses fdlibm, ported into `src/base/ieee754.cc`. Porting the same kernels into
this runtime would make the results bit-identical to node's and let the oracle
go back to being exact. That is the better answer and it is not a small one —
`__ieee754_rem_pio2` alone is a few hundred lines of constants that have to be
transcribed exactly, and transcribing them is precisely the kind of work where a
mistake looks like a 1-ULP difference. It is worth doing when there is a reason
to be bit-identical to V8 rather than merely conforming. There is not yet.

## What else fell out

The reference-counting tests could not compile under AddressSanitizer:
`nts_recycled` is declared under `NTS_PROVIDER_RC` and used under
`NTS_RECYCLES`, and the sanitizer build is the one case that turns recycling
off, so the array was declared and never used against `-Werror`. It had been
that way since 940cbe8 and nothing failed, because the workspace suite is not
usually run with the sanitizer enabled. It surfaced here only because this
change made me run the whole suite before committing rather than the parts I had
touched — which is the argument for running the whole suite.
