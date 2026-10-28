# JetStream 3 DateTimeFormat-intl

This is a strict TypeScript transcription of [DateTimeFormat.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/DateTimeFormat.js), [helper.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/helper.js), and [benchmark.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/benchmark.js) at revision `3967678fa8ab98d847ab33cf3728dba726fa854b`. The deterministic input generator is transcribed from the same revision's [JetStreamDriver.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js).

## Original inputs and validation

The 100 original dates begin at local `new Date(1800, 11, 5, 13, 6)` and advance by 1,234,569 milliseconds. All 25 locales, four date styles, and four time styles produce 400 shuffled option combinations. Each combination performs 17 `format` calls and 17 `formatToParts` calls, followed by the original seven range-loop steps. The range loop intentionally does not advance `dateIndex`; it makes 392 actual `formatRange` calls in a complete run. Its range text is not added to the original length total. The original final result concatenates the last formatted date with the last range text.

The original validation requires at least **438000** accumulated text code units per complete iteration. Under the independently checked Node 24.20.0 environment, one original iteration produces **445369**; its original two-iteration check also passes. The source's check and error message are preserved, with an assertion failure becoming a thrown error because benchmark output is silent.

This row is **nondefault** in JetStream and registers two outer iterations. Its `runIteration` body is synchronous despite the driver's `AsyncBenchmark` registration. `work(n)` performs `n` whole original `runTest` calls; `seed = 1` retains every fixed inner input and loop. `work(1) = 4088381521` and `work(2) = 986280098` in the recorded environment. The checksum folds the computed length and actual final result text; it is not a constant validator count.

## Typing and harness adaptations

Generators, arrays, iteration order, numeric arithmetic, Intl constructors, and native calls remain intact. Types describe the original option objects, parts, callback observations, and class fields. The source's bare class fields still create their original undefined own properties in order. No cast or non-null assertion escapes the checker.

The driver-provided Jenkins random generator is localized in `random.ts`. Its exact arithmetic, initial seed 49734321, and reset before each complete iteration are retained without assigning global `Math.random`. `helper.ts` retains the original shuffle and all locale strings; the shell console bootstrap is omitted. Diagnostic `console.log` calls become a silent local function, preserving argument evaluation. The original `console.assert` condition becomes a silent assertion that throws on failure; `Number(iterationCount)` spells the original multiplication's coercion when a caller omits that optional constructor value.

The timed adapter retains one module-level `Benchmark` and keeps its previous `lastResult` alive throughout the next `runTest`. It resets only the per-work numeric accounting and iteration count, while the source method replaces the result. Optional result observations allocate records only when a test supplies the callback. `render(n)` uses a separate fresh observer instance and is absent from the timed path.

The last-result concatenation uses a typed helper with exactly the original JavaScript `+` coercion: two undefined locals produce NaN, while either string operand causes string concatenation. All full workload runs assign both string results. No date, timezone, calendar, or numbering-system option is added.

## Independent verification and host context

The complete upstream program runs unchanged in an isolated VM using the original driver random setup. A separate observation run compares every constructor option, formatted string, formatted part, selected category, and applicable range with the port for one and two complete iterations, alongside zero-iteration adapter checks. The full source workload, helper, and `Benchmark` syntax trees match after reversing the documented typing/diagnostic/observer adaptations. The original random function and reset bodies match exactly. There are **14392** observed events per full iteration.

Reference checks use **Node 24.20.0**, **ICU 78.3**, **Unicode 17.0**, and the host **UTC** timezone. Intl output depends on the engine's locale data; DateTimeFormat also retains the source's default timezone behavior. The port deliberately supplies no locale or timezone options absent from upstream. Reference output hashes and checksum values describe that recorded environment, not a normalized cross-engine result.

## Licence

The original workload and helper carry Apple 2025 and Google 2025 BSD-2-Clause notices. The wrapper carries Apple 2025 BSD-2-Clause, and the driver random adapter is covered by the pinned JetStream Apple BSD-2-Clause licence. Full notices are retained in the source and recorded in the shared `LICENSE-jetstream`. No runtime Intl/ICU data is copied.

## Timing

Timing exception (approved): **138.521302000 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41e34ac77c200000`. Maintainers compile with nts, record oracle counts and measure on their own machines.