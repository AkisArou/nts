# JetStream Noble secp256k1

Source: [WebKit/JetStream revision `3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b), `bigint/noble-secp256k1-bundle.js`, `bigint/web-crypto-sham.js`, `bigint/noble-benchmark.js`, and the deterministic generator in `JetStreamDriver.js`.

Licences are permissive: Noble and Noble hashes are **MIT**, copyright Paul Miller; the original sham carries Dominic Tarr's MIT notice, its Buffer code credits Feross Aboukhadijeh under MIT, its stream construction code retains the Joyent/Node contributors MIT notice, and its SHA implementation retains sha.js MIT and Paul Johnston/contributors BSD notices. The benchmark driver and deterministic generator retain their Apple BSD-2-Clause notices. Original notices and exact revision links are retained in the source files.

## Original workload

The complete 85,225-byte points literal is preserved, followed by the source's own filter and `slice(0, 1000)`. No input bound is introduced by the port. The original `x = 2`, window size 8, fixed private keys, message, Schnorr message/key, loops and awaits remain intact. The point-decoding loop retains its original increment both in the body and in the loop update.

Every iteration performs 20 random public-key generations, the two fixed public keys, the initial async ECDSA signature, ten further async signatures, 20 synchronous signatures, four ECDSA verifications, a recovered signature and four public-key recoveries, four ECDH operations, 20 ECDH operations with a precomputed point, 20 explicit point decodes, three Schnorr signatures and four explicit Schnorr verifications. Schnorr's internal signature verification remains in place. Original precomputation and tagged-hash cache lifetimes are retained. The driver's seeded Jenkins generator resets to `49734321` before each iteration.

`work(n): Promise<number>` awaits `n` complete original iterations. `seed` is 1 and `work(0)` returns zero. A bounded checksum observes actual final outputs from the key, signing, verification, recovery, ECDH, decoding and Schnorr operations. The adapter retains each loop's last existing result and performs no extra cryptographic call or per-vector hashing. `runNobleBenchmark()` exposes the complete final operation results for independent tests; callers of that lower-level function use `resetRandom()` for the original driver's preparation boundary.

## Both original hash implementations

The workload uses **two different pure JavaScript implementations**, and both remain present. Synchronous operations use the bundled Noble SHA256/HMAC classes. Async operations await the original web-crypto sham's sha.js SHA256/HMAC path. Neither is replaced with native crypto, native Buffer or the other implementation.

The sham HMAC constructor executes the original stream construction path even though the workload uses only `update` and `digest`. The port preserves its ReadableState, BufferList, EventEmitter table, WritableState, CorkedRequest, Transform state, bound callback, other callback closures, and `prefinish` registration. Fields retain their initialization order. Per complete first iteration, independent traces match **60 HMAC constructions**, **60 of each retained stream-state/callback allocation**, **120 default-options objects**, **120 EventEmitter initialization calls**, **578 byte-buffer allocations**, and **139 sha.js SHA256/Hash initializations**.

This is the closed hash-mode dependency path. It is not a general stream or Buffer implementation. The original full workload never invokes the allocated `onwrite`, `onCorkedFinish`, `afterTransform` or `prefinish` callback bodies. Their callback objects and captures are retained; the unused execution bodies are explicitly unavailable because their general stream path requires the browser process/timer shim. General stream reads, writes, end/flush/destroy execution, pipe/resume scheduling, data/readable event handling, multiple/new-listener event execution, options-based callback/encoding replacement, Buffer string encodings, and unused hash algorithms are omitted. Tests independently trace zero executions of all four callbacks in the full original workload.

## Type and module adaptations

All 117 Noble core function bodies were matched to historical v1.7.0 TypeScript and transcribed from the pinned runtime source. Plain field declarations preserve class layouts without adding eager initialization. A readonly curve object replaces setup-only freeze. Fixed getter/setter declarations preserve the original first-assignment-only sync-hash registration. One checked function read replaces a non-null assertion in the synchronous DRBG; typed-array and public-key unions reflect inputs the original accepts.

Browserify exports and global crypto registration become local imports. The pinned bundle explicitly disables its empty native-crypto stub, so that unavailable fallback is omitted. A Uint8Array subclass replaces the bundled Buffer prototype setup, and its fixed species getter preserves Uint8Array subarray views. Its actual allocation, copy, fill, read and write paths retain their original loops. Fixed class metadata and an explicit empty HMAC clone allocation replace unused clone-path prototype reflection. CipherBase's original finalizer function becomes fixed class metadata; the original own `digest`, `__final`, `_final`, decoder and encoding assignments remain ordered.

No npm dependency, host I/O, global mutation, runtime prototype mutation, descriptor operation, reflection or generated code is used. BigInt, WeakMap, async functions and actual source builtins remain available for the compiler to accept or refuse.

## Validation

Strict TypeScript passes. Source checks cover all 117 core functions, 21 complete module/static declarations, all four hash accessors, 28 Noble hash functions and six hash constants, the original endian assertion, the complete points literal, the entire benchmark body after removing only result captures, and all retained stream-state constructor bodies.

Two consecutive full original/port trials match complete operation records and every async hash/HMAC input and output. The first trial has 139 crypto calls and the next 136 because the original tagged-hash prefix cache persists. All 60 HMAC constructor states, their nested field order, callback arities and allocations match per trial. Additional checks cover 56 HMAC key/message combinations, both implementations, intermediate state and cloning, plus ten SHA inputs. The full final operation record has SHA256 `9446c2e1f956865b42b290f784a2e737bd283d9d49a835ca9295bbe995862c56`. `work(1)` is `3639362170`; `work(2)` is `755033204`.

## Timing

Timing exception (approved): **71.790343000 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

A scratch awaited adapter uses the harness's original warmup, calibration and best-of-five loops, awaiting each complete call. This is provisional async timing; the repository harness is unchanged. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41eb1d884f400000`. Maintainers compile with nts, record oracle counts and measure on their own machines.
