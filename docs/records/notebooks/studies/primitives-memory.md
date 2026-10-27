# Memory study (C and LLVM): report

Saved by MainClaude from the study's final message, 2026-10-22. Two WIP commits on compiler/prim-memory, over 5a2242da2:
- f484e4d7f: the queens fixes;
- f3f652c0c: loop-carried element forwarding for Wasm/JVM, untimed.
Other arms are hand-edits in exp/. The baseline is frozen in base-bin/. Timings: the harness's best of 5 on CPU 4 under with-lock, A/B alternated, A/A spread 1.3-6.5%; instructions per op from perf (load-free).

## Losing rows, decomposed

- **awfy-queens** (C 11.58 µs, C++ 5.34):
  - `this.freeRows!` null-tests the field, and `use_keeps_the_array_here` counts the compare as handing the array away, so every Queens field loses its length.
  - The interprocedural fixpoint widens every parameter after three changes, so `getRowColumn`/`setRowColumn`'s `c` jumps to the i32 limit. `c + r` becomes i64, and no index is provable.
- **map-entries-top-k** (30.29 against C++ 18.17): `nts_release` is 25.5%. `lower_sort_with` merge-sorts over two counted copies, about 5,600 count operations per 256-entry sort. The map key is retained twice, and there are three out-of-line erased releases per iteration.
- **awfy-list:** not memory. Instruction for instruction it's C++'s, but the 20-byte hot loop straddles a 64-byte boundary (IPC 3.5 against 5.3).
- **json-parse:** 39% of the time destroys the previous document node by node; `JsonValue` is cyclic, so it takes the candidate path.
- **awfy-towers:** the f64 pile index (the numbers area).

## Experiments (ns, base → arm)

| Arm | Row | Result |
|---|---|---|
| **Queens fixes** (f484e4d7f) | queens | C 11.19 → 8.80 µs (−21.4%), LLVM 11.02 → 8.81 (−20.0%); instr 368k → 245k (C++ 129k) |
| | permute | −6.5% / −6.3% |
| | (scope) | emitted C changes on these two of 69 cases only |
| **Inline RC fast path** (acyclic, count above 1, no counters) | top-k | 28.86 → 21.05 µs (−27.1%) |
| | json-parse | −8.1% |
| | bounce | −9.9% |
| | objects | unchanged |
| **Uncounted sort moves** | top-k | −11.7%; with the fast path 20.01 µs (−30.7%) |
| **Parse regions** | json-parse, region per parse (RC) | 0.686 ms (−37.5%; RSS 21.7 → 7.7 MB) |
| | with the fast path | 0.647 ms (−41%) |
| | NoGc in a region (the ceiling) | 0.478 ms (−56.5%), equal to the JVM, beating node's 0.566 |
| **Loop alignment** | awfy-list, 32 bytes at link time | 10.05 → 7.36 µs (−26.7%), C++ 7.33, parity |

## Design

1. **Queens fixes as written.** An `==`/`!=` doesn't hand an array away, and only parameters of functions on a call cycle (Tarjan) widen.
2. **Inline release fast path.**
   - Decrement in the header; out-of-line code only for the last release and for cyclic types.
   - The compiler knows each type's cyclicity statically, so acyclic releases never load the descriptor.
   - The counters build only under a define that tooling/memory and the runtime tests set.
   - The header-sized allocation (string design §3) is unmeasured.
3. **A count-free sort:** an i32 index permutation over one counted snapshot plus a counted write-back, about 4n count operations.
4. **Call regions,** as core analysis.
   - A callee qualifies when every allocation it makes is dead by return or reachable only from its result, and it stores nothing into parameters, globals or caches.
   - The caller resets the region at the result's last use, and calls a region clone compiled without counting.
   - Risks: a throw out of the region, and runtime helpers that cache.
5. **Loop alignment** in the native build (`-Wl,-plugin-opt=-align-loops=32` at the LTO link), checked across every row first.

## Rows to add

sort-objects (rc), tree-teardown (rc), release-acyclic (rc), field-array-index.

## Staged plan

1. **Queens.** Fixtures: a field null-tested before indexing keeps its length (control: the field is passed to a call); a non-recursive callee keeps a bounded parameter (control: it recurses). Plus the five test262 records and a compile-time check.
2. **The RC fast path,** with runtime C tests, cycle-collector tests, tooling/memory with the define, and ASan.
3. **The count-free sort,** with fixtures for a comparator that mutates, one that throws, stability, and `toSorted`.
4. **Call regions,** with fixtures for an escaping result (refused), a throw, a global write (refused), and cached helpers.
5. **Loop alignment.**

## Decisions for the user

1. Does NoGc stay a shipping provider?
2. Region clones (code size per callee)?
3. JsonValue-shaped types count as cyclic even when every instance is a tree: pay the collector's cost, or a way to declare a type acyclic?

## Handed elsewhere

- The f64 index in towers: numbers.
- The map key's double retain: objects.
- A note on json-parse in strings-audit/memory-study-note.md.
