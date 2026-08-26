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
| test262 (numeric slice) | whether our arithmetic *is* JavaScript's | nothing |
| Are We Fast Yet | how fast we are on programs chosen by someone else | closures, inheritance, module state; then a port |

## The thing all three need first

None of them is a correctness oracle on its own. The TypeScript cases check
types, test262 is written against a JavaScript runtime we do not have, and Are
We Fast Yet measures time. What turns any corpus into a correctness oracle is
being able to run a program both ways and compare.

We already have both halves. `compiler/codegen/c/tests/execute.rs` compiles an
example, links a C harness and runs it; `benches/common/bench.mjs` imports the
same `.ts` and runs it on node. Nothing joins them up outside a test.

**Deliverable: `nts check <tsconfig>`.** Compile, link, run, run the same source
on node, compare every exported function's result over a set of inputs. Report
agreement, disagreement, or refusal.

This is small — both pieces exist — and everything below is worth more once it
exists. It is also the only way to verify the Are We Fast Yet port did not change
the programs.

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

## Phase 2 — test262, the numeric slice

Most of test262 is irrelevant: `eval`, proxies, prototypes, getters on
`Object.prototype`. Three directories are not:

- `test/language/expressions/` — the operators
- `test/built-ins/Math/`
- `test/built-ins/Number/`

These cover exactly the semantics that have cost us the most: `ToInt32`
wrapping, `Math.round` going half-toward-`+∞` rather than away from zero,
`%` taking the sign of the dividend, `-0` surviving where it is observable,
`Math.min` propagating NaN where `fmin` does not. Every one of those was a bug we
found ourselves, some of them twice.

Many of these tests are literally `assert.sameValue(expr, expected)`. Two ways to
use them, and we should do both:

1. **Extract the value pool.** `facts.rs` sweeps a hand-picked pool of doubles
   through every transfer function. test262's arguments are a pool chosen by
   people trying to break implementations. Folding them in costs nothing and
   makes four million existing cases sharper.
2. **Extract the assertions.** A `sameValue` over an expression made of
   supported operations becomes a `nts check` case directly.

What this will *not* do is run as a suite. The harness (`assert.js`, `sta.js`,
`propertyHelper.js`) assumes a JavaScript runtime. Extraction is the workflow,
and the extractor is a script we own.

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
   test of fidelity and it costs one script.
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

## Open decisions

1. **Pull the 19,000-case TypeScript submodule?** It is a large clone. The 296
   vendored cases are enough to build the harness against; the full corpus is
   worth it once the harness exists.
2. **Upstream the AWFY port?** It would be the reference TypeScript
   implementation for a suite that has ten others. It also means writing to
   someone else's review standard, which is a cost and a discipline.
3. **C++ reference column for AWFY only, or convert `benches/cases/` too?** Two
   reference conventions in one runner is a smell; one of them should win.
