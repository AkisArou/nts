# 0001 — What the tsgo API transport actually costs

Status: measured; Gate G1 passes
Recorded: 2026-08-26

The compiler obtains TypeScript semantics by speaking tsgo's API protocol over a
pipe (RFC §7.1). The stated risk was that type information arrives over RPC, and
that a whole-program compiler needing a type for essentially every expression
would degrade into an N+1 problem measured in millions of round trips.

That risk was accepted deliberately. This record is the measurement that decides
whether it was real.

## Method

Generated TypeScript projects, compiled through `nts frontend` against tsgo 7.0.2
built from the pinned `third_party/typescript-go` submodule (`typescript/v7.0.2`,
commit `2bd066d`). Round trips are counted by the client, not estimated.

## Result

Measured twice: first with AST and types only, then again once symbol resolution
and module exports landed.

**AST and types only**

| Files | Lines | Nodes decoded | Types resolved | Round trips | Per file |
| ----: | ----: | ------------: | -------------: | ----------: | -------: |
| 1     | 5     | 31            | 25             | 4           | 4.00     |
| 40    | 520   | 8,560         | 7,080          | 82          | 2.05     |
| 250   | 3,000 | 54,750        | 46,750         | 502         | 2.01     |

Round trips were **`2 + 2n`** in the number of files.

**Complete frontend** — adding `getSymbolsAtLocations` and `getExportsOfModule`

| Files | Nodes  | Types  | Symbols | Modules | Round trips | Per file | Elapsed |
| ----: | -----: | -----: | ------: | ------: | ----------: | -------: | ------: |
| 250   | 54,750 | 46,750 | 8,750   | 250     | 1,002       | 4.01     | 1,660 ms |

Round trips are now **`2 + 4n`**: two fixed, and four per file —
`getSourceFile`, `getTypeAtLocations`, `getSymbolsAtLocations`,
`getExportsOfModule`. The 250-file case resolved 46,750 types and 8,750 symbols
in 1,002 exchanges. Per-node RPC would have needed over 90,000.

Wall clock rose from 471 ms to 1,660 ms for the same program. That is real and
worth watching — symbol resolution makes the checker do work that type queries
alone did not — but it is a constant factor on a curve that is still linear in
files.

## Why it does not degrade

Two properties of the API, and the implementation holds to both:

- **ASTs move in bulk.** `internal/api/encoder` writes a flat binary layout —
  28 bytes per node plus a shared string table — and `getSourceFile` returns a
  whole file as one payload. AST transfer is one exchange per file, not per node.
- **Type queries batch.** `getTypeAtLocations` takes a list of node handles, so a
  file's type queries collapse into one exchange.

Neither is free to keep. `handleGetTypeAtLocations` returns on the first
unresolvable handle, so anything that forces a per-node fallback also
reintroduces the per-node cost. `NodeList`s are the live example: they occupy a
nil slot in tsgo's node table, and one in a batch loses every type in it.

## What would falsify this

`FrontendStats::round_trips_per_file` is reported on every build and asserted in
`compiler/frontend-ts/tests/tsgo_transport.rs`. A value that climbs with program
size means batching has leaked and the transport needs revisiting — which the
`SemanticSource` trait exists to make possible without touching a downstream
crate.

## Corrections this record supersedes

The concern as originally stated — "N+1 at whole-program scale, millions of round
trips" — was wrong about ASTs, which are bulk-transferred, and overstated for
types, which batch per file. It is recorded here rather than deleted because the
reasoning that produced it is the reasoning `round_trips_per_file` now guards.
