# JetStream Stanford PBKDF2

Source: [WebKit/JetStream, revision `3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b).

- [Original benchmark](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/stanford-crypto-pbkdf2.js)
- [Original SJCL library](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/sjlc.js)

The Apple 2018 benchmark is BSD-2-Clause. SJCL explicitly offers BSD-2-Clause or GPL; this port selects **BSD-2-Clause** and preserves its complete original notice and Stanford contributor credits. Every source file retains the corresponding upstream header.

## Workload and validation

Each iteration derives the complete original 256-bit result using password `b4db33f`, salt bytes `BA DB EE FB AD BE EF 00`, and all **2048** iterations. The original expected output remains an assertion in the measured operation:

```text
5436c4c0d73e425a521f4a5a13e0fffe5cd957a823f435385fa0a75068a26803
```

`runIteration()` exposes that validated output. `work(n)` repeats complete upstream iterations and folds every hexadecimal output character with `checksum = (checksum * 31 + codeUnit) >>> 0`. `seed` is 1. Inputs and the internal count are never scaled.

## Adaptations

The complete called SHA256, HMAC, PBKDF2, bit-array and hexadecimal-codec dependency path is transcribed. Fixed namespace/constructor/prototype registration becomes typed functions and classes. Fields use `declare` to preserve initialization order. HMAC reads the hash's original fixed block size through `static readonly` metadata instead of a prototype lookup; its `mac` alias still returns the same function as `encrypt`. A checked overload preserves the original digest implementation that ignores a forwarded argument. Concrete local unions retain the original variables' changes of type, and the optional output-length comparison explicitly excludes `undefined`, whose original numeric comparison was false.

SHA256 retains its original generated constants, arithmetic, UTF-8 codec, typed-array and ordinary-array branches. Shared tables are initialized before measurement, as in the upstream library. The single explicit `Number(d.pop())` in bit shifting preserves the numeric coercion of the original bitwise expression. Uncalled cipher, PRNG, mode and host-entropy APIs are outside this workload. The adapter adds only the returned output and outer repetition/checksum.

No npm dependency, Node API, runtime prototype mutation, reflection, descriptor operation, or generated code is used. A compiler refusal of an original source builtin remains a finding.

## Timing

Timing: **4.272056421 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41cea6d3f0800000`. Maintainers compile with nts, record oracle counts and measure their own machines.

