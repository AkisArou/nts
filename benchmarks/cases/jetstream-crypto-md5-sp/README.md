# JetStream 3.0: crypto-md5-SP

This typed transcription is derived from the RSA Data Security, Inc. MD5 Message-Digest Algorithm.
The source is [SunSpider/crypto-md5.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SunSpider/crypto-md5.js)
at JetStream 3.0 release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`.

## Complete original workload

Each `run()` retains the complete original **989-character**
Shakespeare text literal and performs the original four doublings inside the run,
producing **15824 characters**. It hashes that complete
string and performs the unchanged original digest assertion:

```text
a831e91e0f70eddcb70dc61c6f82f6cd
```

Every `Benchmark.runIteration()` still calls `run()` **22 times**.
There is no RNG or external input. The input is not shortened, split, prehashed,
decoded at startup, or replaced with generated data. The source's original
8-bit character packing, padding, word order, shifts, wrapping arithmetic and
round constants are unchanged. The full source includes the original hex,
unpadded base64 and raw-string encoders, HMAC routines, and VM self-test.

## Types and adapter

Only erasable parameter/return types, numeric `Array` type arguments, exports and
two observations after the original digest assertion are added to the original
function bodies. The sparse ordinary arrays remain ordinary arrays; the port
does not initialize their holes or replace them with typed arrays. The complete
original `Benchmark` class is identical after type erasure, including its inner
repetition count. It has no fields or constructor work.

One benchmark instance is created outside `work`. `work(n)` repeats full original
benchmark iterations and mixes the resulting complete digest into a 32-bit
checksum. Every digest character participates; the checksum is then accumulated
once for each complete benchmark iteration. `render(n = 1)` returns the latest
validated digest, and `observation()` also reports the original input length.
The six original public digest/HMAC entry points and the VM self-test are exported
for independent correctness checks.

No native crypto API, Node import, I/O, dynamic evaluation, reflection, prototype
mutation, `any`, assertion cast, or non-null assertion is introduced into the case.

| Call | Checksum |
|---|---:|
| `work(0)` | 0 |
| `work(1)` | 1,301,045,875 |
| `work(2)` | 2,978,762,336 |

## Validation

Strict TypeScript checking passes. On exact Node **24.20.0**, the untouched
upstream benchmark passes its full original iteration, and the transcription
produces the same digest and input length. All 21
original function bodies match after type erasure and removal of the two explicit
observation assignments. The complete input literal, including escaping and line
continuations, matches exactly.

Additional comparisons cover **16 input messages** and **four HMAC cases**, in all
three output encodings: **60 comparisons** agree with both untouched upstream and
an independent Node crypto oracle. Cases include empty strings, standard vectors,
padding/block boundaries, high UTF-16 code units under the original low-byte
packing, and HMAC keys longer than one block. The Node oracle is used only by the
external correctness test, never by this benchmark.

`provenance.json` records the source/input hashes, exact expected outputs, source
audit, validation evidence and checksum values. Target-backend compilation has
not been claimed; an nts refusal should remain a finding rather than prompting
an algorithm replacement.

## Timing

Timing: **4.161589913 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41d363189cc00000`. Maintainers compile with nts, record oracle counts and measure their own machines.

## License

The implementation is distributed under **BSD-3-Clause**. Its original Paul
Johnston copyright and contributor credits are retained, followed by the full
author-supplied BSD notice from
[the author's legal page](https://pajhome.org.uk/site/legal.html#bsdlicense).
The author also requires the RSA Data Security, Inc. MD5 Message-Digest Algorithm
identification and accompanying notice. Both the original attribution and the
complete additional notice are retained in `case.ts`. The author explicitly
states that distribution under the BSD licence is permitted.

The benchmark glue is also covered by JetStream's Apple BSD-2-Clause repository
notice. The companion `../LICENSE-jetstream` collects the shared notices.
