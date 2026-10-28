# JetStream 3.0: bigint-paillier

This ports the complete original **synchronous 1024-bit Paillier workload** from release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`. Seed **1** runs one full key generation and the original encryption, homomorphic addition/multiplication, decryption and validation operations. No key size, trial division table, primality rounds or message values are reduced.

## Pinned sources and licences

- [`bigint/paillier-bundle.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/paillier-bundle.js) — SHA-256 `19f2138cfd65396e33b3376603ec05cf91e7416300af00d7f9a5e227a5a6b642`.
- [`bigint/paillier-benchmark.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/paillier-benchmark.js) — SHA-256 `57baec1c4341d41d84419a9bfb1b473e548b85a4da0cdebb8f2b6f324affc1e7`.
- [`bigint/web-crypto-sham.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/web-crypto-sham.js) — SHA-256 `ad545999d81802b3ca371fea3f02f49fb07fb0fd7e0253fa5f7b29f7142489c6`.
- [`JetStreamDriver.js`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js) — SHA-256 `05d3e59df671e03bdb81c6896d3784d15db993447de2acb07207a1733dd8a5cd`.

The included Paillier/BigInt implementation is MIT, copyright 2018 Juan Hernández Serrano. The called random-byte shim is MIT, copyright 2013 Dominic Tarr. The benchmark is Apple 2022 BSD-2-Clause; the exact driver RNG is Apple 2018–2024 BSD-2-Clause. All applicable complete original notices are retained in the owned source files. Companion notices are collected in [LICENSE-jetstream](../LICENSE-jetstream); `provenance.json` records exact Git blobs, scopes and omissions.

## Original workload and lifecycle

The original `generateRandomKeysSync(1024)` creates primes, modulus, generator, private values and both key objects inside every iteration. The complete original PublicKey and PrivateKey classes remain, including additional methods not called by this particular driver. Class declarations use erased fields, retaining the original constructor assignments and property order.

The workload encrypts `12345678901234567890n`, decrypts it, then encrypts `5n` and decrypts the homomorphic sum. It also multiplies the first ciphertext by plaintext `10n` and decrypts that result. The original final validation checks, unchanged, require:

- `12345678901234567890n`
- `12345678901234567895n`
- `123456789012345678900n`

One original Benchmark instance lives outside `work`. Its flags remain true on valid iterations. The exact driver RNG starts at **49734321** and resets **before every iteration**, as in release `preIterationCode`. Its six integer-mixing steps, division by 2^32, random-byte packing and allocation of each requested typed array remain unchanged. Each complete original iteration consumes **113410 RNG draws** in this pinned workload.

## Included paths and adaptations

The 17 retained helper/key-generation functions are recorded in `provenance.json`. Their complete bodies match the release after removing types and restoring the local `webCryptoSham` binding. Both complete key classes match after type erasure. The large original small-prime table and Miller–Rabin arithmetic remain intact.

The fixed outer export object and `__esModule` descriptor become module exports. Unused asynchronous prime/key generation, Worker/source-string construction, availability detection, and the shim's digest/import/sign methods are omitted. The registered workload calls only synchronous key generation and `getRandomValues`; its complete unchanged baseline passes without Workers or host crypto. Uncalled bundled SHA, HMAC, Buffer and stream implementations are therefore not included.

The shim retains an object literal and its own original `getRandomValues` method. It uses the local copy of the exact driver RNG, without assigning global Math or crypto objects. Its uninitialized temporary is truthfully typed; `?? 0` at the bitwise use preserves JavaScript's undefined-to-zero conversion. The original integer-array type guard and 65,536-byte request limit remain. Erased overloads and explicit BigInt temporary types resolve typing without replacing arithmetic or introducing assertion casts.

After the original decryption checks, a bounded observation serializes 13 actual key, ciphertext and plaintext fields to complete decimal strings. Each code unit and string length contributes to unsigned multiply-by-31 hashing. This observes key generation and encryption results as well as the fixed decrypted messages. The original key objects are not retained by the adapter. `render(n)` returns the latest full field strings in the order recorded by `provenance.json`, while `observation()` reports those strings, completed iterations, checksum and validation state.

| Call | Expected result |
| --- | ---: |
| `work(0)` | 0 |
| `work(1)` | 4044231636 |
| `work(2)` | 2921743272 |

## Verification

Strict TypeScript checking passes. The untouched release executes one complete 1024-bit iteration and its original validation. Independent original and port executions produce exactly equal **13 full key/ciphertext/plaintext fields**, with equal RNG consumption. The full trace SHA-256 is `2acbf8a6152ee4ff23bf63b1151694179de6706150fa94416ba5da0ed309f1cd`.

Thirty-five array comparisons cover all seven original accepted integer-array types and byte-packing boundaries. A separate small known-key oracle checks encryption, decryption, additions, positive/negative multiplication, random-factor recovery, field order and original errors. The complete original Benchmark body and all validation methods match after removing the observation call. The original RNG and random-byte method also have AST equivalence checks after their documented local binding/coercion changes.

## Timing

Timing exception (approved): **489.370117000 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41ee21c27a800000`. Maintainers compile with nts, record oracle counts and measure on their own machines.