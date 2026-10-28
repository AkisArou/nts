# JetStream 3: Synchronous filesystem

Real-code row with no C++ reference.

## Source and licence

Pinned release revision: `3967678fa8ab98d847ab33cf3728dba726fa854b`.

Source: [generators/sync-file-system.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/generators/sync-file-system.js).

BSD-2-Clause, Copyright (C) 2023 Apple Inc.; original notice retained.

## Transcription and validation

All 5,000 directories and 1,200 generated files, DataView byte-order operations, recursive generators, visitor dispatch and deletions remain. The timed adapter retains the previous filesystem while building its replacement, matching the original driver. Per-call numeric totals/hash reset makes the opaque-n checksum stable; original validator/class bodies are unchanged. Listing objects use truthful discriminated branches and adapter observations use guarded narrowing.

Every final name, directory relationship, surviving byte, count and hash matches upstream at n=1 and n=2. The original validation yields 1,108 surviving files, 5,000 directories and last-file hash 436945457. Five-iteration lifetime comparisons retain the old root during all 6,000 buffer constructions.

`work(n)` repeats complete original iterations; `seed = 1`. The input count remains opaque to the harness. Strict TypeScript and the case's checks in `benchmarks/jetstream.test.ts` pass under Node 24.20.0.

## Measurement

Timing exception (approved): **11.6171856 ms at seed = 1 under Node 24.20.0**; one full original iteration exceeds 10 ms and its input remains complete.

The unchanged suite harness warms up and calibrates inside Node, then takes the best of five trials. Five sequential fresh processes were measured; the number above is the lowest process result, for local scale only.

Checksum `work(1)`: **438165245**; Float64 bits: `41ba1ddefd000000`.

Maintainers compile with nts, record oracle counts and measure their own machines. A compiler refusal is retained as a finding.
