# JetStream Noble BLS12-381

Source: [WebKit/JetStream, revision `3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b), specifically `bigint/noble-bls12-381-bundle.js`, `bigint/web-crypto-sham.js`, `bigint/noble-benchmark.js`, and the deterministic generator in `JetStreamDriver.js`.

The Noble code is **MIT**, copyright 2019 Paul Miller. The browser crypto shim carries the original Dominic Tarr MIT notice; its called Buffer implementation credits Feross Aboukhadijeh under MIT, and its SHA code retains the sha.js MIT and Paul Johnston/contributors BSD notices. The benchmark driver and deterministic generator retain their Apple BSD-2-Clause notices. Full applicable notices and source links are retained in the transcription.

## Complete workload

Each iteration retains the original **32 complete G2 vectors**, fixed private keys, and messages. It computes the vector public keys, four pairings, 50 public-key generations, the initial signature, four further signatures, four verifications, 50 public-key aggregations, 50 signature aggregations, and the two final hash-to-curve calls. The original `x = 1`, every loop, all awaits, and the full field, curve, pairing and serialization algorithms remain intact. Module constants and the original precomputation caches retain their lifetime across iterations.

`work(n): Promise<number>` awaits `n` complete iterations and returns a bounded checksum of actual final pairing, public-key, signature, verification, aggregation and hash-to-curve data. `seed` is 1, and `work(0)` returns zero. Capturing the last existing result of each loop adds no cryptographic call or inner-loop hash. `Benchmark.runIteration()` and `runNobleBenchmark()` expose the computed objects, including all 32 vector public keys, for independent validation.

The original benchmark asserts only successful completion. Independent tests compare the full final operation results and all vector public keys against the pinned original bundle, rather than introducing a different workload validation rule. The original verifications return `true` for this input.

## Type and module adaptations

The complete original JavaScript algorithms were matched to historical Noble v1.4.0 TypeScript to recover their types. The pinned JetStream source remains authoritative: this port retains its direct `message` digest argument and its detached static-method fixes returning `PointG1.ZERO` and `PointG2.ZERO`.

Classes declare all fields without adding eager initialization. Concrete `pointClass` getters replace dynamic `this.constructor` construction and class comparisons; they dispatch to the original PointG1 or PointG2 class. The arithmetic, creation order and concrete receiver checks are preserved. Fixed two- and three-element constructor spreads become explicit indexed arguments while retaining their original map allocations. Two invariant checks replace unchecked nullable assertions, and the hash function's setup metadata receives a checked type refinement. These checks do not substitute default results.

Browserify registration, descriptor exports and `self.crypto` lookup become ordinary local modules. The bundle explicitly disables its empty native-crypto stub; that unavailable fallback glue is omitted. The shim calls the original JavaScript SHA256 implementation, including its shared schedule array, complete compression loop, block buffering and padding. No native cryptographic function or native Buffer replaces it. The Buffer operations actually called by SHA are transcribed as a Uint8Array subclass with the same numeric allocation, fill, read and write loops. Unused string encodings, other hash algorithms, HMAC and stream execution APIs from the larger bundle are outside this case's called dependency closure.

An explicit Hash initializer permits the derived SHA class to preserve the original field-write order (`init`, schedule, then block state) without runtime prototype mutation. The local deterministic generator preserves the driver's original arithmetic and reset boundary; this BLS fixed workload does not request random bytes. Global mutation, descriptors, reflection, generated code, npm dependencies and host I/O are absent. BigInt, maps, sets, async functions and other actual source features remain available for the compiler to accept or refuse.

## Validation

Strict TypeScript passes. Source-structure checks cover all **144 math functions**, all **59 index functions** (with the checked metadata wrapper recorded separately), **58 complete constant/module declarations**, the entire benchmark body after removing only result captures, all SHA256 functions and both SHA tables. The vector literal is byte-identical.

Two consecutive full original/port iterations produced identical complete operation records and the same **36 SHA256 input/output calls in the same order**. Additional checks cover 19 incremental hash inputs and intermediate state/field order, 145 Buffer cases, 24 concrete point dispatch cases, and nine invalid receiver/scalar cases. The complete final result record has SHA256 `8c5c6fee0dfc2d706d6987b0a0f4034bf661a42c5e741edde63e864e093a6372`. `work(1)` is `1288326282`; `work(2)` is `549204404`.

## Timing

Timing exception (approved): **728.576594000 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

A scratch awaited adapter uses the harness's original warmup, calibration and best-of-five loops, awaiting each complete call. This is provisional async timing; the repository harness is unchanged. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41d3329322800000`. Maintainers compile with nts, record oracle counts and measure on their own machines.
