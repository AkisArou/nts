# 0002 — Type decomposition costs round trips per type, not per file

Status: measured; decomposition is opt-in until reachability exists
Recorded: 2026-08-26

[0001](0001-frontend-transport-cost.md) established that producing a semantic
snapshot costs round trips proportional to **files**, because ASTs transfer in
bulk and type queries batch per file.

Decomposing structured types does not share that property, and this record is
the measurement of what it costs instead.

## Why it cannot batch

`getTypeAtLocations` takes a list. The endpoints that answer *what is inside* a
type do not:

| Endpoint | Parameter | Batched |
| --- | --- | :---: |
| `getTypesOfType` (union/intersection members) | one type | no |
| `getPropertiesOfType` | one type | no |
| `getTypeArguments` | one type | no |
| `isArrayType` | one type | no |
| `getTypesOfSymbols` | many symbols | **yes** |

Only the last batches, which is why an object's properties cost two exchanges
regardless of how many properties it has — the symbols come back in one call, and
their types in another. Everything else is one exchange per type.

## Result

250 generated files, 3,000 lines, tsgo 7.0.2 from the pinned submodule.
Re-measured once symbol resolution and call signatures landed.

| | Round trips | Per file | Elapsed |
| --- | ---: | ---: | ---: |
| Complete frontend | 1,002 | 4.01 | 1,713 ms |
| + decompose all, with signatures | 13,006 | 52.02 | 2,252 ms |

Decomposing 3,002 of 3,256 distinct types costs **+12,004 round trips** and
**+539 ms**. Marginal cost is ~4 exchanges per type: one for a union; two for an
array; three for an object; four for a function type (`getSignaturesOfType`,
a batched `getTypesOfSymbols` for parameters, `getReturnTypeOfSignature`, plus
the `isArrayType` probe that precedes them).

### Correction: round trips are not the wall-clock cost

An earlier revision of this record reported "14.5x the round trips and **4.7x the
wall clock**" and treated the two as the same finding. They are not.

13x the round trips buy only **1.31x** the wall clock. At ~0.045 ms per exchange,
the pipe is nearly free; what costs is the checker work behind each answer. The
4.7x figure was also inflated by comparing against a 450 ms baseline that did not
yet include symbol resolution — the same decomposition against the complete
frontend is a 31% increase, not a 370% one.

The absolute cost is what to reason about: **decomposition adds roughly half a
second to a 250-file program**, whether or not the baseline moves.

## Decision

Decomposition is **opt-in** (`TsgoApi::with_decomposition`, `nts frontend
--decompose`) and off by default.

The engine is worklist-driven from a **seed set** rather than sweeping the arena.
That is the part built for the future: today the caller seeds it with every
interned type, because nothing yet knows which types a build will reach. When
reachability lands (RFC §7), only the seed argument changes — the walk, the
memoization, and the cycle handling stay as they are.

## What this says about reachability

The 3,256 distinct types behind 46,750 typed nodes are the whole program,
including every type of every unreferenced export in every file. A real product
reaches a fraction of that, so a seeded walk should decompose far fewer.

That remains worth doing, but the corrected numbers make it a real optimization
rather than a prerequisite. Half a second on 250 files is a cost worth removing,
not a wall. Decomposition being opt-in already keeps it off the default path, and
the worklist is seeded rather than sweeping, so reachability slots in by changing
one argument whenever it arrives.

## Guardrails

- [`Budget`] bounds a walk, and `decomposition_exhausted` is reported rather than
  swallowed. A partial type graph is a legitimate result; presenting it as
  complete is not.
- Arrays are detected before being decomposed as objects. An array *is* an object
  type, so the naive path yields `length`, `push`, `map` and the rest of the
  prototype instead of an element type. There is a test asserting no decomposed
  object carries a `push` property.
