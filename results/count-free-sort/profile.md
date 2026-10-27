# Remaining sort cost

The measured index-buffer binaries, profiled flat on CPU 4 under with-lock with cpu_core/cycles/u. Each runs 12,740 hot calls plus two pre-hot calls, with the original checksum and repeated-addition guard. C and LLVM have zero lost samples. These samples include startup and warmup, unlike the hot-window counters in paired.md.

| Portion | C % of total samples | LLVM % of total samples |
|---|---:|---:|
| Comparator dispatch / generic result conversion | 0.00 | 0.00 |
| Comparator field loads, subtraction and JS truthiness | 29.26 | 5.39 |
| Merge/index addressing, selection and loop control | 48.33 | 57.72 |
| Allocation entrypoints | 0.32 | 0.82 |
| Counted snapshot copy | 1.76 | 2.70 |
| Other work and cleanup | 20.33 | 33.37 |

ThinLTO already inlines the visible comparator in both binaries. Neither hot loop has a closure call, generic numeric result coercion, or per-element bounds/refusal check. Zero dispatch is a static code finding, not a claim that floating-point comparison is free. Allocation entrypoints omit setup inlined into work; that setup remains in Other work. The comparator body includes its field loads, subtraction, and the JS `||` zero/NaN test. The returned number's sign test belongs to merge selection.

The category split sums sampled instructions, not precise stalled cycles: ordinary cycle sampling can skid across neighboring instructions. Local work percentages are multiplied by its flat whole-program share (C 92.54%, LLVM 88.10%). Comparator ranges are C [0x3310,0x3323), [0x336e,0x3383); LLVM [0x330b,0x332a). Merge ranges, minus comparator ranges, are C [0x31cb,0x33a3), LLVM [0x31cb,0x3383). Each range refers to the exact saved binary in the raw run. Rounded percentages can differ slightly from 100.

| Hot-loop property | Emitted C after clang/ThinLTO | Emitted LLVM after ThinLTO |
|---|---|---|
| Stored permutation | uint32, scale-4 loads/stores | uint32, scale-4 loads/stores |
| Snapshot object loads | scale-8 pointers | scale-8 pointers |
| Merge cursors | XMM registers, double arithmetic | XMM registers, double arithmetic |
| Address preparation | vcvttsd2si then zero-extension | vcvttsd2si then sign-extension |
| Repeated stack spills inside the inner loop | none | none |
| Comparator invocation | inlined field loads/subtraction | inlined field loads/subtraction |
| Truthiness | zero/NaN test then another sign comparison | ordered-not-equal path then sign comparison |
| Selection join | extra forward join jump and moves | more direct selection/backedge |
| Bounds checks inside merge | merge exhaustion tests only | merge exhaustion tests only |

C's hot comparison and selection chain attracts most of its excess samples. It retires about 1.572M instructions/call against LLVM's 1.524M, only 3.2% more, while wall time is about 56% higher. This localizes the gap to the hot loop and its dependency/control shape; it does not prove that the extra jump alone causes it. A missing comparator specialization cannot explain it because that comparator is already inlined. The next investigations are integer induction facts for generated cursors on all backends, then C comparison/truthiness emission, each measured independently. No such mechanism is part of this change.

The C source spells JS truthiness as `(v5 != 0.0) && !isnan(v5)` followed by goto/merge assignments. LLVM emits `fcmp one double %v5, 0.0` followed by a phi. Both preserve zero and NaN semantics. The sort selection then tests the numeric result against zero. Any later emission change must preserve that contract.
