# External suites: what to run against, and in what order

Our own suite is 257 tests and 7 benchmark cases, and every one of them was
written by me. That is the problem with it. It tests what I thought to test, and
it measures programs I chose because they exercise optimizations I had just
written. Neither is evidence about code nobody wrote for this compiler.

Three external bodies of work fix different parts of that. This says what each
one answers, what it costs, and the order that gets the most out of them.

| Suite | Answers | Blocked on |
| --- | --- | --- |
| TypeScript's own test cases | what we can compile, and whether we survive real code | nothing |
| test262 | whether implemented ECMAScript behavior matches the specification | representation recovery and a script/test host for the full runner; nothing for the existing numeric extractor |
| Are We Fast Yet | how fast we are on programs chosen by someone else | closures, inheritance, module state; then a port |

## Give each suite its own oracle

These suites answer different questions and therefore do not share one verdict
model. TypeScript's cases carry checker expectations. Test262 is self-checking
and declares negative phase/type in metadata. Are We Fast Yet supplies programs
whose ports need output checks before timings are comparable.

`nts check <tsconfig>` remains the right differential instrument for ordinary
programs and the extracted Test262 expression pool: compile, link, run, execute
the same source on Node, and report agreement, disagreement, or refusal. It is
also how the Are We Fast Yet port proves that every language variant computes
the same checksum.

That differential does not replace Test262's oracle. A standards-correct runner
judges NativeTS directly against each test and its metadata; a Node control, if
enabled, is reported separately.

## Phase 1 — TypeScript's test cases

`third_party/typescript-go/testdata/tests/cases` is already vendored: 296 files,
169 of them single-file. A first pass over those, taking a couple of minutes:

```
169 attempted
 67 fail typechecking by design   (they are type-error tests)
 54 lower completely
  0 compiler panics
```

Two things come out of this that our own tests cannot give.

**Robustness.** 169 arbitrary TypeScript files went through lowering, the
optimizer and the SSA verifier without a panic or a rejection. That number should
be zero forever, and it is only meaningful measured against code we did not
write.

**A ranked work queue.** The refusals, by frequency:

```
43  a parameter of an unrepresentable type
19  a name declared outside this function     -- module state, closures
 6  a function without a body
 3  this statement is not supported
 3  a class of unrepresentable type
```

That ordering is data rather than intuition, and it decides phase 3.

The full corpus — roughly 19,000 cases — is behind an uninitialised submodule at
`third_party/typescript-go/_submodules/TypeScript`. Worth pulling once, running
nightly, and tracking two numbers over time: **panics, which must stay zero**, and
**lowered fraction, which should climb**.

Note the top refusal is uninformative as it stands. "A parameter of an
unrepresentable type" does not say *which* type, and a histogram whose largest
bar is unreadable is not yet a work queue. The diagnostic should name the type.

## Phase 2 — test262

There are two distinct instruments here. The existing numeric extractor is a
differential test of arithmetic and constant folding; a future Test262 runner is
a conformance test whose oracle is the test body and metadata. Node is useful as
a control for the former and optional diagnostics for the latter, but it cannot
decide a Test262 verdict.

Three directories remain the cheapest high-value input to the current
extractor:

- `test/language/expressions/` — the operators
- `test/built-ins/Math/`
- `test/built-ins/Number/`

These cover exactly the semantics that have cost us the most: `ToInt32`
wrapping, `Math.round` going half-toward-`+∞` rather than away from zero,
`%` taking the sign of the dividend, `-0` surviving where it is observable,
`Math.min` propagating NaN where `fmin` does not. Every one of those was a bug we
found ourselves, some of them twice.

Many of these tests are literally `assert.sameValue(expr, expected)`. The
extractor uses them in two ways:

1. **Extract the value pool.** `facts.rs` sweeps a hand-picked pool of doubles
   through every transfer function. test262's arguments are a pool chosen by
   people trying to break implementations. Folding them in costs nothing and
   makes four million existing cases sharper.
2. **Extract the assertions.** A `sameValue` over an expression made of
   supported operations becomes a differential case directly.

This extractor is not Test262 conformance. The standards-correct runner will
instead preserve the suite's YAML metadata, strict/sloppy variants, separate
harness and include units, fresh realms, and exact negative phase/type. It is
blocked first on the general `NeedsRepresentation` analysis for
checker-accepted untyped JavaScript, then on top-level script execution and a
typed host boundary. Compiler refusal remains unsupported rather than becoming
a pass. See `docs/conformance/test262.md` for the complete protocol.

## Phase 3 — the features

Closures, module-level state, inheritance, growable arrays. This is both the top
of phase 1's histogram and the gate on phase 4, which is a good sign — two
independent measures agreeing on what to build next.

Order them by the histogram once the diagnostic names types, not before.

## Phase 4 — Are We Fast Yet, ported to TypeScript

The suite exists to compare *language implementations* fairly, so its benchmarks
are deliberately held to a subset of features common across JS, Java, C++, Ruby
and Smalltalk. That restriction is nts's design point too, which is what makes it
the right target rather than merely a famous one.

It has no TypeScript port. Ports to ten other languages exist and the suite ships
guidelines for writing them, so this is the intended workflow rather than a
workaround — and a faithful port is upstreamable.

### Sizing

| | files | bytes |
| --- | --- | --- |
| micro: bounce, list, mandelbrot, nbody, permute, queens, sieve, storage, towers | 9 | ~24 KB |
| `som.js` — the shared Vector, Set and Dictionary | 1 | 11 KB |
| macro: richards, deltablue, havlak, cd, json | 5 | ~103 KB |

`json.js` is 38 KB of which most is embedded test data, so the macro half is
smaller than it looks. Micro first, then the collections, then macro.

### Harness changes this needs

Our runner already does three of the things that matter, and they were not free,
so they are worth restating before changing anything around them.

- **Checksums are compared across every variant.** A backend that is fast
  because it computes the wrong answer fails the benchmark rather than winning
  it.
- **Node startup is not measured.** `bench.mjs` times inside the process with
  `process.hrtime.bigint()` and prints nanoseconds per operation; the runner
  parses that number and never looks at node's wall clock.
- **The JIT is warmed.** 20,000 iterations before the first timed run.

Three things do have to change.

**Warmup must become per-case.** 20,000 iterations is 20 ms for a 1 µs
microbenchmark and something like twenty minutes for Havlak. Each case needs its
own warmup count, in the same `provider`-style per-case file, and the default
stays where it is.

**Calibration must handle one iteration exceeding the budget.** Both harnesses
target ~100 ms of work and clamp `reps` to at least 1, so a slow benchmark
already runs rather than dividing by zero — but best-of-five then means five
timed iterations, and the run-to-run spread wants reporting rather than hiding.
For those cases the harness should print the spread alongside the minimum.

**`verifyResult` is better than a checksum and we should have both.** AWFY
benchmarks carry the expected result for each inner-iteration count, so they
check against an absolute rather than against each other. Cross-variant agreement
catches a backend that diverges; `verifyResult` catches all variants being wrong
together, which is exactly what a hand-port can cause.

### The reference column

AWFY has a C++ port. That is better than the hand-written C in `benches/cases/`,
because someone other than the person being measured wrote it. Compiling it with
`clang++` under the same `-O2 -flto` gives a reference column for all fourteen
benchmarks without writing a line of it.

The `nts f64` column keeps working unchanged, and stays the most informative one:
same program, specialization off, run against itself.

### Keeping the port honest

The risk is specific. A hand-port is where a program accidentally becomes
*easier* — an annotation that hands the analysis a fact V8 has to discover, a
loop restructured while transcribing, an object flattened because the OO was
inconvenient. Our checksum rule catches a port that computes the wrong answer. It
does not catch one that computes the right answer too cheaply.

Three defences:

1. **Run both on node and compare.** The original `.js` and the ported `.ts`
   should produce identical checksums under the same engine. That is a direct
   test of fidelity and it costs one script — and the script existed,
   `benches/awfy/fidelity.mjs`, and was **deleted on 2026-09-05 because nothing
   ran it.** No gate step, no test, no CI; `bootstrap.sh` called it "the
   benchmark fidelity gate" in its help text and that was the only mention
   outside these docs. A check that does not run is worse than one that does not
   exist, because it reads as coverage — the same reason `-Xverify:all` on a
   class with no methods is not evidence. The defence above is still the right
   one; what is gone is the claim that it was in place.
2. **Keep the object orientation.** AWFY uses classes, inheritance and closures
   deliberately, because dispatch and allocation are things it means to measure.
   Flattening the `Benchmark` hierarchy into free functions would produce a
   benchmark that compiles today and measures something else. This is the
   temptation to name out loud, because it will be available at every step and
   will look reasonable each time.
3. **Transcribe, then annotate.** Change control flow in no commit that also adds
   types.

## What this does not cover

**No differential fuzzing.** Nothing generates random TypeScript and compares
nts against node. Every suite here is a fixed corpus, so each one goes quiet once
we pass it. A generator is the only thing that keeps finding bugs after that, and
`nts check` is most of its infrastructure.

**No allocation-heavy external benchmark.** `binary-trees` from the Benchmarks
Game is the canonical one and needs nullable fields for leaves, which we do not
have. Worth revisiting when optionality lands, because it is the workload that
would stress escape analysis, reference counting and the cycle collector at once.

## Decisions

**The port stays here.** Not upstreamed. That removes one of the three defences
against a port that is too easy — someone else's review — so the other two carry
the whole load. Running the original `.js` and the ported `.ts` on node and
comparing checksums stops being a nice-to-have and becomes the thing that decides
whether a port is admissible at all. It runs per benchmark, in CI, and a
mismatch is a build failure rather than a note.

**C++ is the reference, everywhere.** Not only for the Are We Fast Yet cases —
the existing `benches/cases/*/ref-double.c` and `ref-int.c` convert too. Two
reference conventions in one runner is a smell, and the AWFY C++ has the property
the hand-written C never will: someone other than the thing being measured wrote
it. The conversion is mechanical and the checksums prove it did not change
anything.

**The Java port is for later, and it is worth more than it looks.** RFC §1
targets the JVM as well as C and LLVM. When that backend exists, Are We Fast Yet
gives us a hand-written implementation *in the target language* — the same
fourteen programs, written by a Java programmer, against which nts-generated
bytecode can be measured directly. No other suite offers that, and it is a reason
to keep the TypeScript port faithful to the Java one's structure rather than only
to the JavaScript one's.

**The 19,000-case TypeScript submodule waits.** The 296 vendored cases are enough
to build the harness against. Pull the full corpus once the harness exists and
the refusal diagnostic names types.
