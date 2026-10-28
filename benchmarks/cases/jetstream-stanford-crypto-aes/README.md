# JetStream Stanford AES

Source: [WebKit/JetStream, revision `3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b).

- [Original benchmark and complete vector data](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/stanford-crypto-aes.js)
- [Original SJCL library](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/sjlc.js)

The Apple 2018 benchmark and data are BSD-2-Clause. SJCL explicitly offers BSD-2-Clause or GPL; this port selects **BSD-2-Clause**, preserving the full original notice and Stanford contributor credits. Each source file retains its corresponding upstream header.

## Workload and validation

Each iteration runs all **2,100 original vectors**, covering 128-, 192- and 256-bit keys, for **three complete passes**. The original assertions compare every encrypted result with its full expected ciphertext and every decrypted result with its full expected plaintext: 6,300 encrypt/decrypt pairs, 12,600 full block comparisons.

The complete vector literal is retained byte-for-byte. `Benchmark.runIteration()` retains the original loops and assertions. Two assignments in the existing assertion arguments retain the final computed ciphertext and plaintext arrays. After all original loops finish, a bounded observation folds those eight computed words using `checksum = (checksum * 31 + word) >>> 0`. There is no per-vector hashing. `work(n)` repeats full iterations and folds their numeric results with the same recurrence. `seed` is 1.

## Adaptations

Fixed namespace, constructor and prototype registration becomes typed functions and the `Aes` class. Declared fields preserve original instance allocation. A class accessor retains the original shared table arrays and their lazy initialization lifetime. The table generator, both key schedules, encryption/decryption rounds, and bit-array comparison are transcribed with their original arithmetic and control flow. Concrete local unions preserve parameters and locals that change from objects/arrays to numbers. The error object retains its own `toString` function before its message field.

The benchmark instance and shared data live across repeated calls, as upstream. The two observer arrays begin empty at each iteration; their references are replaced by computed blocks in the existing validation calls and consumed after the loops. No table precomputation, reduced data, shortened passes, new algorithm, npm dependency, Node API, reflection, descriptor operation, runtime prototype mutation or generated code is introduced. A compiler refusal of an original builtin remains a finding.

## Timing

Timing: **9.534516727 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41e2161fd7400000`. Maintainers compile with nts, record oracle counts and measure their own machines.

