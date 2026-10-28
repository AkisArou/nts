# JetStream 3: Lazy collections

Real-code row with no C++ reference.

## Source and licence

Pinned release revision: `3967678fa8ab98d847ab33cf3728dba726fa854b`.

Source: [generators/lazy-collections.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/generators/lazy-collections.js).

MIT, Copyright (c) 2020 Robin Malfait; original notice retained.

## Transcription and validation

All nine complete pipelines, input sizes, generators, iterable combinators, Set operations and original totalLength validation are retained. Generic overloads and truthful guards describe the existing synchronous/asynchronous branches. The original array-to-number coercion is explicit; its NaN output remains. Typed narrowing and optional observation are documented with upstream comparisons.

All nine complete outputs match the original. Their lengths are 3, 100, 1, 5, 150, 100, 150, 100 and 26; original totalLength is 635. Additional iterator edge and AST comparisons retain source behavior.

`work(n)` repeats complete original iterations; `seed = 1`. The input count remains opaque to the harness. Strict TypeScript and the case's checks in `benchmarks/jetstream.test.ts` pass under Node 24.20.0.

## Measurement

Timing exception (approved): **21.520527 ms at seed = 1 under Node 24.20.0**; one full original iteration exceeds 10 ms and its input remains complete.

The unchanged suite harness warms up and calibrates inside Node, then takes the best of five trials. Five sequential fresh processes were measured; the number above is the lowest process result, for local scale only.

Checksum `work(1)`: **3341292288**; Float64 bits: `41e8e50260000000`.

Maintainers compile with nts, record oracle counts and measure their own machines. A compiler refusal is retained as a finding.
