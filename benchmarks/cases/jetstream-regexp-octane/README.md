# JetStream 3: recorded RegExp workload

Source: [Octane/regexp.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/Octane/regexp.js), release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`.

The complete V8 BSD-3-Clause notice and credits remain in `case.ts`. The release driver's local deterministic RNG retains its Apple BSD-2-Clause notice. The original 2009 recording and 2010 update, ROT13 strings, regexp literals, operation weights and all twelve blocks are preserved.

## Transcription

The constructor function becomes a declared class with its original per-instance `run` closure. Every recorded input variant is generated during the original setup, and its original initialization run remains outside timed work. The release driver's Robert Jenkins RNG uses the exact initial seed 49734321 and integer arithmetic through a local function, so no global `Math.random` mutation is needed.

Every original iteration executes all twelve blocks five times, retaining each original sum assertion of **1666156**. The adapter retains and returns the actual validated sum, then folds complete iterations with multiplication by 31 and unsigned truncation. There is no shortened input or block, replacement pattern, new algorithm, Node module or C++ reference.

## Correctness

Strict TypeScript passes. All constructor statements containing literals, variants and the twelve blocks compare exactly after type removal; the complete original five-pass loop and assertions also match after removing the checksum observation. Three untouched original iterations and complete observed checksums agree on Node 24.20.0.

`render(n)` returns every complete iteration's validated sum. `work(0) = 0`, `work(1) = 1666156`, and `work(2) = 53316992`.

## Timing

Timing: **8.743452200 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41396c6c00000000`. Maintainers compile with nts, record oracle counts and measure their own machines.

