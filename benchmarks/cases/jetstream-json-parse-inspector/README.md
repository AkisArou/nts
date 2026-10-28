# JetStream 3: Inspector JSON parse

Real-code row with no C++ reference.

## Source and licence

Pinned release revision: `3967678fa8ab98d847ab33cf3728dba726fa854b`.

Source: [SeaMonster/json-parse-inspector.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/json-parse-inspector.js).

Apple BSD-2-Clause, plus MIT notices for inert TodoMVC/css-loader/webpack strings in the unchanged recording.

## Transcription and validation

The original constructor serializes all 846 records once outside timed work. Every iteration parses the complete 7,333,850-character string. A retained Benchmark keeps the previous parsed graph alive until replacement. The adapter adds declared types, opaque repetition and a bounded structural checksum; complete output is checked separately.

Full reserialization, including object key order, matches the untouched upstream result for one and two iterations. Complete output SHA-256: f7594b93901565ac9bef3ec74fe2365a568d2514f0480ac3f1cea1613c376b85.

`work(n)` repeats complete original iterations; `seed = 1`. The input count remains opaque to the harness. Strict TypeScript and the case's checks in `benchmarks/jetstream.test.ts` pass under Node 24.20.0.

## Measurement

Timing exception (approved): **21.1682195 ms at seed = 1 under Node 24.20.0**; one full original iteration exceeds 10 ms and its input remains complete.

The unchanged suite harness warms up and calibrates inside Node, then takes the best of five trials. Five sequential fresh processes were measured; the number above is the lowest process result, for local scale only.

Checksum `work(1)`: **2215243919**; Float64 bits: `41e0813e11e00000`.

Maintainers compile with nts, record oracle counts and measure their own machines. A compiler refusal is retained as a finding.
