# Number inference: what it proves, and what it is worth

`HirType::NUMBER` is `f64` because that is what TypeScript's `number`
conservatively is. Record 0004 measured the cost of that conservatism and got
the framing wrong; this records what the inference actually does, now that it
exists and can be measured.

## What it is worth

`nts f64` is the same TypeScript compiled with specialization off. That column
is what makes the speedup a measurement rather than a claim.

| case | nts | nts f64 | C (double) | C (int) | node | specialize |
| --- | --- | --- | --- | --- | --- | --- |
| accumulate | 1.86 us | 78.1 us | 78.4 us | 1.34 us | 3.69 us | **42.0x** |
| checksum | 6.38 us | 126 us | 182 us | 6.41 us | 10.9 us | **19.7x** |
| fib | 619 us | 620 us | 601 us | 343 us | 1.04 ms | 1.00x |
| loop | 862 ns | 859 ns | 861 ns | 998 ns | 1.00 us | 1.00x |
| mandelbrot | 75.3 us | 75.5 us | 75.3 us | 75.0 us | 76.3 us | 1.00x |

Where the proof lands, the output reaches hand-written integer C and beats V8.
Where it does not, the output is what it was — which is the only acceptable
direction for the error.

The three flat rows are not failures. `mandelbrot` is float arithmetic that no
integer proof touches. `loop` divides by two, so its accumulator is genuinely
fractional. `fib` is unbounded in its *result*, so the range obligation fails
however much is known about its argument — as record 0004's addendum sets out.

## What proves, on real code

```text
triangle       8/8    counted loop, constant bound, accumulated total
pipeline      10/10   three functions, facts crossing between them
weigh          3/3    parameter typed `0 | 1 | 2 | 3`
bucket         4/5    `hash & 1023` from an unbounded input
shard          6/9    `Math.floor(Math.abs(hash | 0) / 65536)`
rounded        0/2    `Math.round(x)` on an unbounded x -- correctly nothing
grouped        0/5    `(a + b) * (a - b)` on plain numbers -- correctly nothing
```

Five things establish an integer, and they are worth naming because each was a
separate piece of work:

1. **Bitwise operators.** `x | 0` and `x & 1023` are proofs by `ToInt32`,
   guaranteed by the language whatever the input was. The only source that
   needs nothing upstream to be provable.
2. **`Math.floor`/`ceil`/`trunc`/`round`.** The same kind of proof, and a
   stronger one: they keep the magnitude instead of wrapping it. They prove
   nothing where the value is unbounded, since `Math.floor(Infinity)` is
   `Infinity`.
3. **Literal types.** `mode: 0 | 1 | 2 | 3` is a fact about every possible
   caller, available without seeing one — the only thing that makes an
   *exported* function's parameter provable.
4. **Call sites.** A non-exported function's parameters are bounded by what its
   callers pass, and its callers' values by what it returns.
5. **Counting iterations.** An accumulator in a counted loop is bounded by trip
   count times increment. Nothing in the value domain can say this.

## The thing that is not about the analysis

Twice the analysis was right and the *backend* discarded the answer, and both
times the loss was larger than anything the analysis gained:

- `ToInt32` on an already-integer operand called a helper that converts to
  double and reduces modulo 2^32 with `fmod` — a library call, in a loop body,
  to truncate an `int64_t`. C spells that as a cast.
- `x | 0` lowers to a coercion of the literal `0`, which clang cannot fold
  because from its side it is an opaque function of a runtime value. The
  analysis had proved the answer was `0` and never said so.

Before those two, the same analysis was worth 1.5x on `checksum`. After, 28x.
A proof that the backend throws away is not a proof of anything.

## What the integer buys, and why it is not just narrower adds

Integer and double addition cost about the same per instruction. The difference
is what the C compiler is *allowed* to do afterwards. Floating-point addition
is not associative, so a double accumulator may not be reassociated, vectorized,
or replaced by a closed form. An integer one may:

```text
triangle()   1000-iteration loop   ->   movsd xmm0, 499500 ; ret
```

Measured apart from the compiler, on programs computing identical results: 4.4x
on a dependent chain, and around 1000x on a plain sum, entirely from the closed
form. That is the real argument for proving wholeness, and it is not visible in
an instruction count.

## Where it stops

- **An exported function's parameters.** Its callers are outside the compiled
  set. Narrowing from the calls that happen to be visible would be unsound —
  the next caller is a linker away.
- **Accumulators the trip count cannot reach.** A loop bounded by a parameter,
  a step that is not constant, more than one back edge.
- **`unknown`**, which is refused outright and should not be — see
  `docs/any-unknown.md`.
- **Module state.** `const SCALE = 8` has a literal type and would be provable
  for free, but globals are not lowered.

## Soundness

The transfer functions are tested by containment against real IEEE arithmetic:
every two-element interval built from a pool of boundary values, against every
other, about four million cases. Stating the property that way rather than
pinning intervals means a precision improvement is not a failure while an
unsound widening still is.

That found four unsoundnesses on its first run, all of which are also in the
3,271-line implementation this domain was learned from: `(-0) * 0` is `-0`,
`Infinity / Infinity` is NaN, `-1 / -0` is `+Infinity`, and `(-0) % x` is `-0`.
None would have been found by reading.
