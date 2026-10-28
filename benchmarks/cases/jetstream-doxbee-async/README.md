# JetStream 3: doxbee-async

Source: [simple/doxbee-async.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/simple/doxbee-async.js), release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`.

The complete original MIT notice credits Gorgi Kosev (2013), and the Apache-2.0 notice credits Google LLC and Benedikt Meurer (2018). Both remain in `case.ts`; the Apache terms are collected in `../LICENSE-jetstream`.

## Full workload and checksum

Every original iteration creates **10,000 operations**, each using the original stream index and `"foo"` path, and returns the original `Promise.all` result. All original async functions, await sites, try/catch and rollback behavior remain. The adapter awaits each complete iteration sequentially and derives a numeric checksum from the actual fulfilled array's length and each result. No operation count or asynchronous step is reduced.

`work(n): Promise<number>` returns **305109008** for `n = 1`, **1173553664** for `n = 2`, and zero for `n = 0`. `seed = 1`. `render(n)` returns every original 10,000-element fulfilled array; every normal result is `undefined`, exactly as upstream. One original `Benchmark` is retained across work calls.

## TypeScript adaptations

The fixed three-module Browserify registration becomes static typed declarations. Constructor functions and prototype assignments become classes, with the same empty object layouts and method bodies. Shared function aliases are expressed as class methods as the repository's object-layout rules require; no workload code observes their function identity. Erased method overloads preserve the original zero-argument implementation arity where calls pass ignored arguments. The record types describe the original version and file values without an assertion escape. No native I/O, Node module, global mutation, new dependency or C++ reference is introduced.

The complete `doxbee` function body and original 10,000-operation loop are unchanged after type removal. In the async variant, an erased overload permits the original query method's broad result type while preserving its empty async implementation body.

## Correctness

Strict TypeScript passes. On Node **24.20.0**, all 10,000 fulfilled results match the untouched pinned bundle. Independent instrumented comparisons also match the ordered calls, arguments, fulfilment/rejection and rollback for a new file (15 calls), an existing file (13 calls), and an injected rejection (9 calls). A structural comparison verifies the complete original algorithm after type erasure. The shared test checks complete result arrays, repeated checksums and zero iterations.

## Timing

Timing exception (approved): **10.883745500 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

A scratch awaited adapter uses the harness's original warmup, calibration and best-of-five loops, awaiting each complete call. This is provisional async timing; the repository harness is unchanged. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41b22f9810000000`. Maintainers compile with nts, record oracle counts and measure on their own machines.

## Draft status

This is an authorized asynchronous benchmark draft. It exports `work(n): Promise<number>` and awaits its real work. The maintainers are adding awaited execution to the benchmark harness and will mark the PR ready when that lands. Local timing uses a scratch adapter with the harness's original warmup, calibration and best-of-five loops, awaiting each call; the repository harness is unchanged. Maintainers compile with nts, record oracle counts and perform final measurements. A compiler refusal remains a finding.
