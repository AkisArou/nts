# JetStream 3.0: hash-map

This is a typed transcription of the complete `hash-map` workload from
[WebKit/JetStream](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/simple/hash-map.js),
pinned to release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`.
Upstream identifies this as a manual JavaScript translation of Apache Harmony's
HashMap, not compiler-generated JavaScript.

## Original workload

Every `Benchmark.runIteration()` creates a new map, inserts all **90,000** integer
keys from 0 through 89,999 with value 42, performs **five complete lookup passes**,
then traverses the complete entry set. It retains all three original assertions:

| Original observation | Expected value |
|---|---:|
| Lookup sum | 18,900,000 |
| Entry key sum | 4,049,955,000 |
| Entry value sum | 3,780,000 |

There is no RNG, input file, browser API, or external dependency. No input or
inner loop is shortened. The constructor still allocates the same sparse bucket
arrays, and rehashing, collision chains, comparisons, mutation counts, iteration
order, and numeric arithmetic retain the source's behavior.

## Types and preserved source behavior

The nine constructor functions and their prototype objects become declared
classes; the three iterator subclasses use `extends` and `super`. All fields
use erased `declare` declarations so the original constructor assignments keep
their order. Generic key/value contracts describe the original primitive and
hashable/equatable object interfaces. There are no `any` annotations, assertion
casts, non-null assertions, prototype mutations, or descriptor/reflection APIs.

The source contains several quirks that this port deliberately retains:

- The constructor computes `_capacity` but allocates with the absent `capacity`
  property. `new Array(undefined)` creates an initial **one-slot array**, with
  threshold zero. The port does not change it to the requested capacity.
- `Entry.clone()` reads absent `_hash`, so cloned entries have an undefined
  `_origKeyHash`. Where the original later uses that value in a bitwise operation,
  `?? 0` explicitly retains JavaScript's undefined-to-zero conversion.
- Key and value iterators call absent `makeNext`, and `KeySet.contains` calls
  absent `contains`. Erased optional fields and checked calls preserve their
  original `TypeError` messages, rather than fixing the method names.
- Nonempty `putAll` calls undeclared `put`. A `ReferenceError("put is not defined")`
  at that point preserves the original failure before argument evaluation;
  nonempty map cloning therefore still fails. No replacement operation is added.

Other checked entry reads narrow nullable bucket/iterator fields at the original
dereference, preserving the original null/undefined error. `Number(boolean)`
retains the original boolean bitwise coercion. The numeric workload's `?? 0`
addends express the original arithmetic conversion of a missing-map `null` value.
Successful benchmark operations still find every original value.

## Adapter and validation

The module constructs its stateless benchmark once, outside `work`. Each
`work(n)` iteration calls the complete original `runIteration`. The map itself
remains local to `run`, as upstream. Three module-local numbers observe the
original validated sums without retaining the map or adding another traversal.
The checksum mixes those three sums with multiplication by 31 and unsigned
32-bit truncation after each step. `render(n = 1)` and `observation()` expose the
three sums for independent tests.

| Call | Checksum |
|---|---:|
| `work(0)` | 0 |
| `work(1)` | 1,981,364,232 |
| `work(2)` | 3,067,650,816 |

Strict TypeScript checking and comparison against untouched upstream pass on
Node **24.20.0**. In addition to the full original workload, the comparison checks
primitive and colliding object keys, insertion/overwrite/removal, entry order,
iterator mutation detection, clearing, constructor failures, and the preserved
source quirks above. `provenance.json` records source hashes and oracle evidence.

## Timing

Timing: **5.638014125 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41dd864e02000000`. Maintainers compile with nts, record oracle counts and measure their own machines.


## License

The source is **Apache-2.0**. Its complete original licence header and NOTICE are
retained in `case.ts`, including the ASF, Intel, IBM and historical Caldera
attributions. The shared `../LICENSE-jetstream` supplies the companion full
licence text. The NOTICE is not replaced by an umbrella licence attribution.
