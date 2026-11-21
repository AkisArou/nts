# Reference arrays release through their own contents callback

This record holds the instruction counts for #904 under #513. The change gives
the runtime's `nts_desc_ref` and `nts_desc_ref_acyclic` one shared, file-static
`release_fields` callback. The callback walks the pointer slots and calls
`nts_release` directly, so a dying array of references no longer goes through
`nts_each_reference` and calls each child through a function pointer.
[`memory-stage1-counts-877.md`](memory-stage1-counts-877.md) predicted the
walker's own share of release-acyclic at 41,472 instructions per call, 2.26%
of the row.

## Instrument

`nts-bench --root <tree> --count release-acyclic sort-objects
map-entries-top-k cyclic-churn` took both counts on CPU 0, outside the
measurement pair 4–5. It ran with the pinned node v26.13.0 while other agents'
gate runs loaded the machine. The count is net user instructions per
operation: repetitions are calibrated by instructions and the matching empty
bracket is subtracted, so load does not move it. The header's band for both
native nts columns is 1 basis point. Both release builds come from this tree:

| Arm | Commit | `nts-bench` SHA-256 |
|---|---|---|
| before | `b6f7e3529d16` (main) | `e75d9bf5b3563929a4addff2c12fbe87cc70b487f0da91cdbb6464fad201fb4e` |
| after | the #904 change on that commit | `fa11a79471438d264ee095f0bf8f25d1642501a4b12d7636bae9ca32c2abd503` |

The raw outputs are kept in `~/.cache/nts-scratch/904/`:

| File | SHA-256 |
|---|---|
| `count-before.txt` | `1829a9e4ab884e969bb28ccfd3b020992a24ddb683de9949a27b91bbdaf54004` |
| `count-after.txt` | `38ed17fb04b003cdd13ce695205bb978ec60e4d16078478ab530247e63669fe9` |

The before count of release-acyclic, 1,832,669 on both backends, is the census
row exactly.

## Counts

| Row | Column | Before | After | Change | Verdict |
|---|---|---:|---:|---:|---|
| release-acyclic | nts C | 1,832,669 | 1,807,821 | −24,848 (−1.36%) | improvement, past the 1 bp band |
| release-acyclic | nts LLVM | 1,832,669 | 1,807,821 | −24,848 (−1.36%) | improvement, past the 1 bp band |
| sort-objects | nts C | 468,806 | 438,309 | −30,497 (−6.51%) | improvement (control) |
| sort-objects | nts LLVM | 480,865 | 450,368 | −30,497 (−6.34%) | improvement (control) |
| map-entries-top-k | nts C | 387,301 | 384,512 | −2,789 (−0.72%) | improvement (control) |
| map-entries-top-k | nts LLVM | 398,771 | 395,982 | −2,789 (−0.70%) | improvement (control) |
| cyclic-churn | nts C | 2,375,872 | 2,375,471 | −401 (−0.02%) | improvement, 2 bp (control) |
| cyclic-churn | nts LLVM | 2,377,856 | 2,377,455 | −401 (−0.02%) | improvement, 2 bp (control) |

release-acyclic saves 24,848 of the 41,472 instructions the census attributed
to the walker. The rest is what the direct loop costs: the slot load, the null
test, and `nts_release`'s inlined fast path. No row lost. The controls also
improve because each one releases arrays of references. The other columns
(C++, Java, node, Bun, ScriptC) run the same programs in both arms, so they are
not part of the comparison.

## Exactness

- `tests/memory/array-with-holes` records 15 operations and 15 allocations
  for both binaries. Its eight null slots cost no counted release.
  `array-of-objects` (18/22) and `cyclic-array` (4/2, 0 candidates) are also
  unchanged.
- `runtime/c/tests/reference_arrays.c` checks null, immortal, shared,
  cyclic, erased and foreign children, plus a million-wide and a million-deep
  teardown, against exact counted releases and live balance. Built against
  main's runtime, only its descriptor check fails. A scratch sabotage that
  tore the deep chain down recursively crashed without ASan (SIGSEGV) and
  stopped with an ASan stack-overflow inside the callback. Peak RSS was
  about 177 MiB plain and about 465 MiB under ASan.
