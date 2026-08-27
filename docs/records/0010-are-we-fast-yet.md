# 0010 — Are We Fast Yet, and what it found

The suite exists to compare *language implementations* fairly, so its benchmarks
are held to a subset of features common across JavaScript, Java, C++, Ruby and
Smalltalk. That restriction is this compiler's design point too, which is what
makes it the right target rather than merely a famous one.

Porting seven of the nine micro benchmarks took nine compiler changes. Two of
them were bugs that produced *wrong code* silently, and one of them was a wall
the analysis had been putting up against itself.

## Keeping the port honest

The risk in a hand-port is specific and it is not correctness. Our checksum rule
catches a variant that computes the wrong answer; it does not catch a port that
computes the right answer *too cheaply* — an annotation that hands the analysis
a fact V8 has to discover, a loop restructured while transcribing, an object
flattened because the object orientation was inconvenient.

Three defences, and the first is the one that matters:

- **`benches/awfy/fidelity.mjs`** runs the upstream `.js` and our `.ts` on the
  same engine and compares. All seven agree.
- **`verifyResult`** is the suite's own check, against the constant it recorded.
  That catches every implementation being wrong together, which cross-variant
  agreement cannot.
- **The reference column is their C++ port**, compiled unchanged. Where it
  differs from the JavaScript — `std::array` on the stack where the original
  allocates, `std::any` boxing the result — those are its decisions, and they
  stand. It was written by the suite's authors rather than by whoever is being
  measured.

The base class is kept. `innerBenchmarkLoop` calls `this.benchmark()` and
`this.verifyResult()` through a `Benchmark` reference, so both are virtual calls
the suite means to measure. `throw new Error('subclass responsibility')` is kept
too, rather than turned into an `abstract` member: the throw is a real call site
a subclass overrides away, and an abstract method is a hole in the table.

## Two silent miscompiles

**A compound assignment to a field wrote nowhere.** `this.x += this.xVel`
lowered to a *rebinding* of the class member's symbol — a name nothing reads —
and the store never happened. The statement compiled to nothing. Three of the
seven benchmarks returned zero because of it, and `this.count++` and
`globalCounter += 1` had the same shape.

The cause was that `=` knew about fields, elements and globals while `+=` and
`++` only knew about names. All three now go through a `Place`, which is named
rather than re-derived for a second reason: a compound assignment reads and
writes the *same* place, so `xs[next()] += 1` calls `next` once, as JavaScript
says. Lowering the target twice called it twice.

**A class with no constructor had one called.** `new Sieve()` emitted a call to
a function that does not exist, and so did `super()` in a class whose base
declares none. `super.m()` assumed the immediate base rather than the class that
*declares* `m`.

## The wall the compiler built against itself

`sieve` measured 3.9x the C++ reference, and its inner loop was entirely
floating point — every counter a double, every index through the full
double-precision bounds check — for a program whose only caller passes 5000.

The cause: the interprocedural analysis stops at a function whose callers are
outside the compiled set, because their arguments cannot be seen. It was asking
`func.exported` for that. But a class exported so another module can import it
makes every one of its methods exported — and in an *executable*, none of them
is callable from outside, because there is no outside. RFC §6.8 says exactly
this, and reachability already honoured it; the analysis did not.

Asking the same question both passes ask — `reachable::root_names` — halved the
benchmark:

| | before | after |
| --- | ---: | ---: |
| awfy-sieve vs C++ | 3.86x | **1.86x** |
| awfy-sieve vs V8 | 1.68x | **0.80x** |

It is the same information the other columns have. clang sees the whole program
under LTO with `bench_run` as its entry; V8 sees the module and specializes on
the types it observes.

## The seven features

- **`for (const x of xs)`** over an array, desugared to an index loop. No
  iterator protocol: `Symbol.iterator` is a dispatch through a property, and an
  array is the case where the answer is known and the loop is a counter.
- **`new Array(n)`** as an allocation with a length. Worth taking rather than
  asking authors to write `[]` and push: an array made at its final size
  allocates once, and a benchmark that pre-sizes is measuring that.
- **An array type across the library boundary.** Decomposition stops at
  `lib.d.ts` because a foreign type pulls the standard library's whole graph in
  transitively — 5,773 types from one file. `Array<T>` is declared there and is
  a type this compiler represents *natively*, so the boundary was refusing
  `Ball[]` for a reason that does not apply.
- **`fill`** on arrays of booleans and of references. Three of the benchmarks
  make their working set that way.
- **`Math.sqrt`**, the one transcendental-looking function that is not one:
  IEEE-754 requires a correctly rounded square root, so C's is JavaScript's on
  every input — including `-0`, which both return unchanged, so `zero_sign` has
  to know.
- **`throw`**, as a termination. There is no `try`/`catch`, so every throw is
  uncaught by construction, and an uncaught throw *is* a termination.
- **Floating-point `%`** is `fmod`, which is not an approximation of
  JavaScript's remainder but exactly it: ECMAScript defines `%` as truncated
  division with the sign of the dividend, and so does C99.

## Two optimisations that were tried and are not here

Both were written, measured, and reverted. Recording them is cheaper than
someone writing them again.

**Specializing signatures.** `specialize` proves values into integers inside a
function and stops at its boundary, so a *number* crosses every call as a
double. Narrowing a non-root function's parameters to the machine types the
interprocedural analysis already proves is sound — that analysis sees every call
site — and it makes `queens` about 7% faster.

It makes `bounce` and `permute` slightly *slower*, because a parameter narrowed
to an integer is widened straight back when the body computes something the
analysis cannot prove whole. `Queens#getRowColumn(r, c)` is the shape: `r` is
provably `0..8` and `c` is a recursive counter that is not, so `c + r` is
floating point and an `int32` `r` costs two conversions. A rule that declined to
narrow in that case removed the regression *and* the gain, because the case it
declined was the one that paid.

Net across the seven benchmarks it was inside the run-to-run spread on this
machine. Two analyses on every compile and two more things that can be wrong is
not worth an unmeasurable difference.

**Field-held array lengths.** *This one was wrong to revert, and the record of
being wrong is the useful part.*

`this.flags[i]` is bounds-checked because the length of an array a *field*
points at is not written down where the read is — unlike a local, which has its
allocation in front of it. Computing it per `(layout, field)` over the whole
program is sound under the condition `allocated_length_is_exact` already uses:
an array handed to a call may come back longer.

The first version removed no checks at all, and "zero checks removed" looked
like a decisive negative measurement. It was a decisive measurement of a broken
pass. Two things were wrong, and both are about the *other* half of the proof:

- The constructor writes `this.freeRows = null` before the real array arrives,
  and that store joined into the length, making it unknown forever. A null
  contributes no length, and excluding it costs no safety: reading `length`
  through a null array faults, and so does the bounds check that would have
  read it.
- A parameter's facts were joined from the argument's fact *at its definition*
  rather than at the call. A loop counter is `[0, 8]` where it is defined — the
  exit value is one of the things it can be — and `[0, 7]` inside the body,
  which is the only place the call is. One past the end is exactly the bound a
  bounds check cannot remove.

With both fixed:

| | before | after |
| --- | ---: | ---: |
| awfy-queens vs C++ | 3.25x | **1.95x** |
| awfy-queens vs V8 | 1.03x | **0.67x** |

`permute` and `towers` keep their checks, and correctly: both index by a value
that descends through a recursion, so the interval domain widens to `-inf`
without a termination argument. C++ does not check at all, which is a different
thing from proving.

The lesson is narrower than "measure": it is that a measurement of *zero* is the
one most likely to be measuring your own bug, and deserves a look at why before
it is believed.

## What is not ported yet

- **nbody** needs static methods (`Body.jupiter()`) and `forEach` with a
  closure. The second is worth doing as a *desugaring* rather than a runtime
  call, so that monomorphization applies and it costs what a hand-written loop
  costs.
- **storage** builds a tree of `Object[]`, which in TypeScript is a recursive
  array type (`type Tree = Tree[]`). `representation` would recurse on it.
- The macro benchmarks — richards, deltablue, havlak, cd, json — need the `som`
  collections, and those need `Map`-like structures with hashing.
