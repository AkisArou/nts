# JetStream 3: Stanford SHA-256

Real-code row with no C++ reference.

## Source and licence

Pinned release revision: `3967678fa8ab98d847ab33cf3728dba726fa854b`.

Source: [SeaMonster/stanford-crypto-sha256.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/stanford-crypto-sha256.js).

The offered SJCL BSD-2-Clause alternative is selected; the Apple benchmark is also BSD-2-Clause. Complete upstream notices remain in both ported files.

## Transcription and validation

The initial hash of b4d and all 4,500 subsequent hashes are retained with the original final-digest validation. Constructor functions become declared classes with matching fields. The complete called SHA-256 dependency path is transcribed from SeaMonster/sjlc.js; unrelated algorithms and host entropy adapters are not part of this workload.

Original final digest: 719043495be84b97fe4f5d7e61c99d6d1ba0cd6974a6b10c684c25a44ddd0c03. The port also agrees on 91 hash vectors, 28 state/lifecycle/error observations, 1,938 helper comparisons and 19 AST checks.

`work(n)` repeats complete original iterations; `seed = 1`. The input count remains opaque to the harness. Strict TypeScript and the case's checks in `benchmarks/jetstream.test.ts` pass under Node 24.20.0.

## Measurement

Timing: **4.8526907895 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms up and calibrates inside Node, then takes the best of five trials. Five sequential fresh processes were measured; the number above is the lowest process result, for local scale only.

Checksum `work(1)`: **3330387455**; Float64 bits: `41e8d035bfe00000`.

Maintainers compile with nts, record oracle counts and measure their own machines. A compiler refusal is retained as a finding.
