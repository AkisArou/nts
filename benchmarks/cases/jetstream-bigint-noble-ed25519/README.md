# JetStream Noble Ed25519

Source: [WebKit/JetStream, revision `3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b), specifically `bigint/noble-ed25519-bundle.js`, `bigint/web-crypto-sham.js`, `bigint/noble-benchmark.js`, and the deterministic generator in `JetStreamDriver.js`.

Noble Ed25519 is **MIT**, copyright 2019 Paul Miller, and noble-hashes retains its 2022 Paul Miller MIT notice. The browser crypto shim retains Dominic Tarr's MIT notice, the numeric Buffer implementation retains Feross Aboukhadijeh's MIT notice, and the shim SHA implementation retains the sha.js MIT and Paul Johnston/contributors BSD notices. The benchmark driver and deterministic generator retain their Apple BSD-2-Clause notices. Applicable complete notices and exact source links are included in the transcription.

## Complete workload

Every iteration keeps the original `x = 1`, precomputation call, fixed private keys, message, all 16 Ristretto encodings, and complete 64-byte hash input. It performs 60 asynchronous public-key generations, 20 asynchronous signatures, nine asynchronous verifications, 65 explicit point decodes, 30 Ristretto hash-to-curve calls, 30 Ristretto decode/encode calls, six Montgomery base-point scalar multiplications, five shared-secret calculations, 30 synchronous public-key generations, 20 synchronous signatures, and four synchronous verifications. All loops, awaits, field arithmetic, point operations, Montgomery ladder operations, and serialization algorithms remain intact.

The original deterministic generator resets before each iteration. The 30 asynchronous and 30 synchronous random private keys consume the original sequence. Module constants and the original WeakMap precomputation cache retain their lifetime across iterations. The original precomputation work stays inside each iteration. Synchronous SHA512 registration stays at its original point after the asynchronous operations; the fixed accessor retains the source's first-assignment-only behavior.

`work(n): Promise<number>` awaits `n` complete iterations and returns a bounded checksum of actual final public keys, signatures, verification results, decoded coordinates, Ristretto encoding, Montgomery result, and shared secret. `seed` is 1, and `work(0)` returns zero. Capturing existing loop results adds no cryptographic call. `Benchmark.runIteration()` and `runNobleBenchmark()` expose those full computed objects for independent validation.

The original driver validates successful completion. It retains Noble's original argument checks and the original hash assertions. The source's three verification groups return **false** for these inputs: the final public key was generated from a random private key, while the signatures use the fixed private key. This behavior is preserved, including the work done by the verification algorithms. The independent oracle checks these actual results.

## Type and module adaptations

The complete core functions match the historical [Noble Ed25519 v1.7.1 TypeScript source](https://github.com/paulmillr/noble-ed25519/blob/c0b1120e74e391c99740e7bbaa61ec84f434e23e/index.ts), which supplies their types. The pinned JetStream JavaScript remains authoritative. Its digest call passes `message`, rather than the recovered TypeScript source's `message.buffer`, so that the bundled sham receives the original byte view.

All class fields are explicitly declared without new eager initialization. Constructor parameter properties become declarations and the same ordered assignments. A readonly curve object replaces setup-only freezing. Ordinary fixed getter/setter declarations preserve the original hash registration without descriptor operations. Browserify exports and global crypto registration become module imports. The pinned bundle explicitly disables its empty native-crypto stub; that unavailable fallback is omitted. Two checked output-presence guards make the completed fixed loops' results available to strict TypeScript without fabricated defaults.

The asynchronous path retains the original **sha.js SHA512**, including the shared 160-word schedule, two-word arithmetic and carries, block buffering, padding, and output writes. Its numeric Buffer dependency is a typed Uint8Array subclass with the original numeric allocation, fill, read, and write loops. An explicit base Hash initializer preserves the original order: derived initialization, schedule reference, then block state.

The synchronous path separately retains the original **noble-hashes SHA512** implementation, its complete 64-bit helper operations, SHA2 base, hash assertions, endian check, and the SHA512/256 and SHA384 classes and setup wrappers included in that module. Fixed concrete `hashClass` getters replace constructor reflection during cloning, including dispatch to each SHA variant. Tests compare cloned state and digests for all three variants. Both original SHA512 algorithms remain separate; neither uses native crypto or native Buffer.

The sham's unused string-encoding, HMAC, stream, other hash, and host-only APIs are outside this case's called dependency closure. Likewise, unused general noble-hashes utility functions are omitted; the complete called hashing algorithms and their state remain. This is a benchmark-specific dependency transcription, not a general Buffer or Web Crypto API. Global mutation, descriptors, prototype reflection, generated code, npm dependencies, and host I/O are absent. BigInt, WeakMap, typed arrays, and asynchronous functions remain for nts to accept or refuse.

## Validation

Strict TypeScript passes. Source-structure comparisons cover all **91 core functions**, **24 complete constant/module declarations**, both hash-registration accessors, all **27 Noble hash functions**, **28 hash helpers/constants**, all **14 shim SHA512 functions**, both shim SHA tables, the three called base-Hash byte paths, and the entire benchmark body after removing only result captures and their guards. The full Ristretto vector source remains byte-identical.

Two consecutive complete original/port trials produce identical full operation records, all **134 asynchronous SHA512 inputs and outputs in order**, and all **60 random requests in order**. Eighteen input lengths cover block and padding boundaries for both SHA512 implementations, SHA512/256, and SHA384. These checks compare initial, intermediate, cloned, and final state where applicable, including own-field initialization order, and compare digests with an independent native hash oracle in tests only.

The complete final operation record has SHA256 `2c0acef9ed5e47fb0ab28355dc373c8a06c44210b8a74ea3884fcce878f67228`. The 16 decoded vector strings joined with newlines have SHA256 `a8981c1cbd4dae299600dc7cef0b9d8f1020eb642aaa6c8bade5386d7e802531`. `work(1)` is `3200872004`; `work(2)` is `634518344`.

## Timing

Timing exception (approved): **94.830097000 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

A scratch awaited adapter uses the harness's original warmup, calibration and best-of-five loops, awaiting each complete call. This is provisional async timing; the repository harness is unchanged. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41e7d92dc8800000`. Maintainers compile with nts, record oracle counts and measure on their own machines.
