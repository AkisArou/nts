# JetStream 3 ListFormat-intl

This is a strict TypeScript transcription of [ListFormat.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/ListFormat.js), [helper.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/helper.js), and [benchmark.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/benchmark.js) at revision `3967678fa8ab98d847ab33cf3728dba726fa854b`. The deterministic input generator is transcribed from the same revision's [JetStreamDriver.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js).

## Original inputs and validation

The five original lists contain one English word; two numeric strings; the three vehicle names; all 25 locale codes; and the original 100 integer strings. All 25 locales, three styles, and three types yield 225 shuffled option combinations. Each combination performs ten `format` and ten `formatToParts` calls while preserving the original rotating list index: 2250 calls to each API per run.

The original validation requires at least **506000** accumulated text code units per complete iteration. Under the independently checked Node 24.20.0 environment, one original iteration produces **508496**; its original two-iteration check also passes. The source's check and error message are preserved, with an assertion failure becoming a thrown error because benchmark output is silent.

This row is **nondefault** in JetStream and registers two outer iterations. Its `runIteration` body is synchronous despite the driver's `AsyncBenchmark` registration. `work(n)` performs `n` whole original `runTest` calls; `seed = 1` retains every fixed inner input and loop. `work(1) = 846399107` and `work(2) = 4094904838` in the recorded environment. The checksum folds the computed length and actual final result text; it is not a constant validator count.

## Typing and harness adaptations

Generators, arrays, iteration order, numeric arithmetic, Intl constructors, and native calls remain intact. Types describe the original option objects, parts, callback observations, and class fields. The source's bare class fields still create their original undefined own properties in order. No cast or non-null assertion escapes the checker.

The driver-provided Jenkins random generator is localized in `random.ts`. Its exact arithmetic, initial seed 49734321, and reset before each complete iteration are retained without assigning global `Math.random`. `helper.ts` retains the original shuffle and all locale strings; the shell console bootstrap is omitted. Diagnostic `console.log` calls become a silent local function, preserving argument evaluation. The original `console.assert` condition becomes a silent assertion that throws on failure; `Number(iterationCount)` spells the original multiplication's coercion when a caller omits that optional constructor value.

The timed adapter retains one module-level `Benchmark` and keeps its previous `lastResult` alive throughout the next `runTest`. It resets only the per-work numeric accounting and iteration count, while the source method replaces the result. Optional result observations allocate records only when a test supplies the callback. `render(n)` uses a separate fresh observer instance and is absent from the timed path.

The original verbose-only log refers to an unbound `value`. A typed throwing helper retains the same `ReferenceError("value is not defined")` at that argument evaluation point. The normal benchmark uses `verbose = false`; no dormant source bug is repaired.

## Independent verification and host context

The complete upstream program runs unchanged in an isolated VM using the original driver random setup. A separate observation run compares every constructor option, formatted string, formatted part, selected category, and applicable range with the port for one and two complete iterations, alongside zero-iteration adapter checks. The full source workload, helper, and `Benchmark` syntax trees match after reversing the documented typing/diagnostic/observer adaptations. The original random function and reset bodies match exactly. There are **4725** observed events per full iteration.

Reference checks use **Node 24.20.0**, **ICU 78.3**, **Unicode 17.0**, and the host **UTC** timezone. Intl output depends on the engine's locale data; DateTimeFormat also retains the source's default timezone behavior. The port deliberately supplies no locale or timezone options absent from upstream. Reference output hashes and checksum values describe that recorded environment, not a normalized cross-engine result.

## Licence

The original workload and helper carry Apple 2025 and Google 2025 BSD-2-Clause notices. The wrapper carries Apple 2025 BSD-2-Clause, and the driver random adapter is covered by the pinned JetStream Apple BSD-2-Clause licence. Full notices are retained in the source and recorded in the shared `LICENSE-jetstream`. No runtime Intl/ICU data is copied.

## Timing

Timing exception (approved): **36.259229500 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41c9398341800000`. Maintainers compile with nts, record oracle counts and measure on their own machines.