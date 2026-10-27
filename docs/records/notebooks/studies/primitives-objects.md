# Objects study (native C/LLVM): report

Saved by MainClaude from the study's final message, 2026-10-22. Working files under ~/.cache/nts-scratch/primitives/objects/:
- the table v2 prototype: t2/support/nts_runtime.c, t2.h, and ported programs in t2/prog;
- scripts/, logs/, perf/, probes/;
- the fresh-object merge prototype: WIP 5ab02d99c on compiler/prim-objects, tree/compiler/core/src/hir/scalarize/merge.rs.

## Headline: a replacement Map/Set table (CPU 4, with-lock, 3 interleaved rounds, µs)

| row | A main | B table v2 | B/A | C v2 + cached string hash | C/A | C++ |
|---|---|---|---|---|---|---|
| map-and-set (rc) | 6.24 | 3.38 | 0.54 | — | — | 19.37 |
| map-word-counts | 8.10 | 5.62 | 0.69 | 3.18 | 0.39 | 9.47 |
| record-word-counts | 8.23 | 5.77 | 0.70 | 3.22 | 0.39 | 13.50 |
| symbol-keyed-map | 21.93 | 20.82 | 0.95 | — | — | 13.75 |

- B beats Bun (0.66×) and node (0.47×) on map-and-set.
- C makes both word counts beat Bun and node, and level with Java.
- Checksums equal main's; main's spread was 0.7-3.7%. The Bun, node and Java figures come from the full bench, another sitting.

## Inventory (native)

- **`NtsMap`:**
  - 16-byte `NtsValue` keys and values (32 bytes an entry); an i32 index at load ≤ 1/2, with linear probing and tombstones.
  - Insertion-ordered entries, with holes.
  - **A run-time `switch (map->kind)`** in every hash and compare, so every inlined get/set carries every kind (`mapWordCounts` is 12 KB of machine code).
  - **No stored hash:** growth re-hashes everything, and a mismatch loads and compares the key. The string hash is FNV-1a per unit, recomputed every lookup (about 36 cycles for "word42").
  - **Gets return `NtsValue`.** Freeing under RC walks every slot, even number-only ones.
- **Type tests:** `instanceof C` is one descriptor compare per class in C's subtree; `"k" in v` is the same op.
- **Optional properties:** every one is an erased 16-byte slot (lower.rs ~55245), even a reference.
- **Same-shape classes** get distinct descriptors (58 cases agree; the instanceof case's comment saying otherwise is stale).

## Losing rows

- **symbol-keyed-map:** the ToInt32 chain on the loop-carried total dominates (cvtsi2sd/addsd/ucomisd, 19.4/10.5/6%), because the map values are doubles; plus a `jmp *%rax` kind switch. Bun: 8.8-9.8 µs as written, 11-13 with a moving key, 12.2-12.6 with non-integer values. JSC wins mostly through integer values.
- **map-and-set:** 16.5% rehash and 8.4% freeing (walking 512 number slots).
- **Word counts:** after the table, string hashing is 43% of what's left.
- **The erasure rows (138 µs everywhere, Bun 84): not erasure.**
  - The floor is two dependent double adds per iteration.
  - Bun runs at 93 µs with seed 12345 and 136.7 with 12345.5; node 136.5.
  - C runs at 136.4 with a double accumulator and 68.1 with an int64 one.
  - So JSC speculates an integer accumulator, and nts can prove one statically: the guard makes the seed i32, and the total is bounded below 2^53. Worth about 2× (numbers).
- **upcast:** the objects cost nothing. The virtual `area()` slot is typed double, so i32 → double → i32; and a virtual call makes three dependent loads against C++'s two (estimated).

## Experiments

### Table v2

Four changes:
- key and value kinds as compile-time constants (no switch);
- typed 8-byte columns;
- 64-bit index slots holding the hash beside the entry, plus a per-entry hash column, so a mismatch needs no key load and growth never re-hashes;
- a linear scan below 8 entries.

Arm C caches the hash in 24 bits of the string header's flags, as a ceiling, not the design.

### symbol-keyed-map arms

| arm | µs | vs A |
|---|---|---|
| A main | 21.93 | 1.00 |
| B table v2 | 20.89 | 0.95 |
| D, B + integer total | 13.33 | 0.61 |
| E, D + `get(absent)` hoisted out of the loop | 3.59 | 0.16 |
| C++ | 13.77 | 0.63 |

### upcast

Main 6.11 µs; an i32 virtual slot 5.29 µs (0.87×); C++ 4.21.

### Fresh-object merge (before the scope narrowed)

- A site tag plus a variable per (slot, representation), per-path instanceof folding, and constructor copying through `inline::splice`.
- Guards: one live object per group, only handled uses, reads only at agreed slots.
- in-narrowing and instanceof lose every allocation.
- An eight-shape probe agrees on C, LLVM, Wasm and JVM (232 cases each). Untimed.

## Design (native)

1. **Replace `NtsMap`** (the struct and about 40 runtime functions).
   - Column kinds chosen once in core from `Map<K,V>`, `Set<K>` and `Record<string,V>`, carried by the HIR and read by both C and LLVM. The JVM's number columns (`ops::table_constructor`) are a backend-only copy of this fact.
   - Each call passes its expected kinds as constants behind one guard, `kinds == EXPECTED`, needed for soundness because bivariance lets a `Map<string,number>` be handed any key. The generic path erases a column once, as the JVM's `eraseKeys` does. **The guard's cost is unmeasured.**
   - Keep the hash in the index plus a hash column, a scan below 8 entries, and no reference walk for scalar tables.
   - Insertion order, holes and cursor-as-index are unchanged.
2. **Shared with other studies:**
   - the cached string hash (strings): a further 0.57× on the word counts;
   - integer facts for what a non-escaping container holds (memory/core): symbol-keyed 0.61×;
   - narrowing a virtual slot's return (calls): upcast 0.87×;
   - bounded integer accumulators (numbers): the erasure rows, about 2×.
3. **Lower priority:** hoisting a table read out of a loop that can't write the table.
4. **Design only:**
   - `instanceof` as a preorder class-id range test;
   - an optional reference field as a nullable pointer plus the header presence bit;
   - the method table inline in the descriptor.

## Rows to add

map-object-keys, map-literal-string-keys, set-strings, map-delete-churn, map-iterate, map-large (100k entries), small-map-threshold (4/8/16), map-values-int, instanceof-deep (20 classes), discriminated-union.

## Staged plan

1. **The core column decision plus the guarded fast path** (C/LLVM; string and number keys; double and NtsValue values). Fixtures:
   - a typed table used as `Map<unknown,unknown>`;
   - ±0 and NaN keys;
   - delete and reinsert during for...of, and clear during iteration;
   - printing and JSON of a typed table;
   - `in` and `Object.keys` on a Record.
   Re-argue the memory suite's map-and-set floors.
2. **Pointer keys plus the small scan:** symbol, object and `Symbol.for` keys, and an object key dying under RC.
3. **The JVM reads the core column fact.**
4. **The cached hash** and compile-time hashes of literal keys, with strings.
5. **Integer value columns,** with memory.
6. **Class-id range tests.**

## Open questions

1. A per-process random seed for string hashing, against hash flooding? (Bun's draft fix took a colliding JSON.parse from about 2.5 s to 3 ms.)
2. Holes are reclaimed only by `clear`, so a churning table grows forever: compaction with a live-cursor list now or later?

## Not measured

The guard's cost; how B's gain splits among its four changes; LLVM timings (it shares the runtime); the descriptor and optional-field estimates; JVM/Wasm after the narrowing.
