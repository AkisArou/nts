# JetStream 3.0: bigint-bigdenary

A complete strict TypeScript transcription of the release's BigDenary workload, pinned to `3967678fa8ab98d847ab33cf3728dba726fa854b`. Seed **1** performs one complete original iteration: **60,006 arithmetic/comparison calls**, with full decimal inputs and original validation.

## Sources and licences

- [bigint/bigdenary-bundle.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/bigdenary-bundle.js): U-Zyn Chua's 2020 MIT-licensed BigDenary library. All original helpers, methods, comparisons and aliases remain.
- [bigint/bigdenary-benchmark.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/bigdenary-benchmark.js): Apple 2022 BSD-2-Clause workload, complete input strings, original first/last equality checks, and final validation.

The full original notices remain in `bigdenary.ts` and `case.ts`; companion notices are collected in [LICENSE-jetstream](../LICENSE-jetstream). `provenance.json` records source Git blobs and SHA-256 values.

## Workload and lifecycle

The two original inputs are `8965168485622506189945604.1235068121348084163185216` and `2480986213549488579706531.6546845013548451265890628`. Every iteration exercises addition, subtraction, negation, comparison, multiplication and division. For each operation the source computes one first result, then runs its original 10,000-call loop and compares the first and last results. Thus each operation runs **10,001 times**. None of these calls, digits or operations are omitted.

The original inputs and one `Benchmark` instance are initialized outside `work`, matching the release lifecycle. Valid iterations do not mutate the input decimals and keep the original validation flag true, so repeated independent `work(n)` calls remain deterministic without moving setup into the timed body. Every call executes the original final `validate(n)` after its complete iterations. No RNG is involved.

## Type and adapter changes

The global export/IIFE is replaced by local module exports. Class fields use erased `declare` declarations: they do not insert initial values or alter constructor property ordering. The original static `BDCompare` assignment remains.

`getDecimals` spells the original primitive numeric coercion as `isNaN(Number(n))` because TypeScript's global `isNaN` signature accepts a number. A checked receiver in the default equality callback permits the helper to share the original numeric `Object.is` comparison path without assertions or `any`.

After each original first/last comparison, the adapter converts the validated last result to its full decimal string, mixes each code unit and its length with unsigned multiply-by-31, and records the latest six strings. This is bounded observation storage; it does not retain the temporary BigDenary object graph. Every operation of every complete iteration contributes to the returned checksum. `render(n)` returns the latest six output strings after running the same workload, and `observation()` exposes their count, checksum and original validation flag.

The source's dormant behavior remains unchanged. In particular, a direct bigint constructor argument reads `_decimals` before assignment and throws `TypeError: Cannot convert undefined to a BigInt`; negative-half scaling retains the original rounding behavior. These are upstream findings, not corrected algorithms.

## Original results

| Operation | Full output |
| --- | --- |
| `plus` | `11446154699171994769652135.7781913134896535429075844` |
| `minus` | `6484182272073017610239072.4688223107799632897294588` |
| `negated` | `-8965168485622506189945604.1235068121348084163185216` |
| `comparedTo` | `1` |
| `multipliedBy` | `22242459414977784277756671231780478707994020113321.23150840471075112427918006080333207646587562555648` |
| `dividedBy` | `3.6135503037706326689001125` |

| Call | Expected checksum |
| --- | ---: |
| `work(0)` | 0 |
| `work(1)` | 789035237 |
| `work(2)` | 3645266058 |

## Verification

Strict TypeScript checking passes. The untouched release benchmark passes its complete original iteration and final validation. The port matches all six full results and **373 constructor/operation comparisons**, covering every alias, comparison, rounding/scaling, exponential input, invalid input and preserved error case. The comparison trace SHA-256 is `a84dbb96347e200e6960229516aff8cd2590ed449d1e29bcb3f06bdcdc3517bc`.

An AST comparison proves the entire original BigDenary class is identical after type erasure, including all 33 members. All six helper bodies match except the documented explicit `isNaN` coercion. The original Benchmark class, full input declarations, and first-plus-10,000 loop also match after removing the observation statements.

## Timing

Timing exception (approved): **15.789568200 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41c783dc72800000`. Maintainers compile with nts, record oracle counts and measure on their own machines.