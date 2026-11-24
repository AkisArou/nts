# Point-sensitive null slots (#916)

The contents slot owner supplies ownership's initialization answer for fields
and constant array elements. `rc.rs` consumes that answer. Fresh allocations,
written slots, explicit null stores and returned-object fields meet over CFG
edges and phis; a writer or call that cannot be attributed destroys authority.
The transfer has an exhaustive `OpKind` classification.

This is stage 1's single ownership answer from `docs/foundations/memory.md`:
contents owns the state, initialization consumes its store answer, ownership
uses converged return/parameter contracts, and RC consumes the resulting plan.
The old `zeroed_parameters` and `returns_nulled` flat scans are replaced by the
same CFG transfer used for allocation freshness. Their valid empty-slot cases
are reproduced; their alias, conditional-return and intervening-call omissions
are corrected and enumerated below. Fields and array elements use one slot key.
#899's monotonic indexed-write extension is intentionally a later task on this
owner, rather than a second analysis inside #916.

Return contracts reach a least fixed point bottom-up over call-graph SCCs.
Parameter contracts reach a greatest fixed point top-down and require every
reachable direct caller to vouch for the field. Published, virtual, closure and
resume entries receive no direct-caller promise. Each return field is added at
most once and each parameter/field is removed at most once; every SCC converges
before its successors consume the answer.

Consuming-entry materialization can leave an unreachable borrowed adapter.
Preparation prunes with its existing reachability owner before ownership,
only for explicit closed Entry roots after an implementation was materialized.
Unknown roots, EveryExport and open roots retain their entry guards.

## Reentrancy

Foreign-counted retain and release hooks can re-enter compiled code. The fixed
per-function transfer inputs use each slot's declared old type, including
array elements and globals, rather than assuming that its new value describes
what cleanup can release. A potentially foreign retain invalidates facts before
the initialization answer is consumed. A potentially foreign old-value cleanup
invalidates them after publication and the write, unless the slot was already
proved empty. Erased values conservatively include foreign handles; an explicit
erasure retains its payload's known family. A managed release can run user
code synchronously too: `nts_free` gives up the foreign handles of what it
frees. So a released value or old slot value whose type leads, through the
cycle graph's slot and field edges, to a layout holding a handle or an erased
field is foreign cleanup (`Program::foreign_releases`). Only a managed value
that leads to none is not; its FinalizationRegistry jobs execute later.
Retaining a managed value never runs code, so only handles and erased values
invalidate before a store. A handle or erased value can be counted after its
definition and around any read, so every operation that defines or reads one
charges a native count. A managed value that leads to a handle re-enters only
when given up, and is never given up before an operation that reads it, so its
release is charged only to the last operation in its block that defines or
reads it; a terminator's read is charged to the operation before it, whose
delayed cleanup ends the block's facts before an edge. A parameter no block
reads is never stored, so never taken over, and its callee gives up nothing.

The fixed metadata also covers native counts inserted after value definitions
and around operand uses, rather than only stores. Copied field results can
retain a foreign reference before a later store. A native local held to the end
can release it after the last source null store. Both are unknown calls at their
actual boundary. Before effects precede caller parameter vouching; returned
field facts precede caller-side after effects.

A may-have-foreign-cleanup Boolean survives CFG edges and unknown writers,
joins with OR, and consumes unknown-call effects at block exits before outgoing
state or normal-return contracts are read. The facet adds one Boolean to the
finite lattice. Explicit erasure families are memoized once per value, including
out-of-order definitions, and operand families are constant-time lookups; fixed
metadata is linear in values and operand edges. Pointer views conservatively
include foreign keepers. Known managed, scalar and null erasures remain
nonforeign, while unknown erased values remain conservative.

The direct-call harmless predicate reads the same immutable inputs before slot
summaries start, so a callee cannot hide a native count. Fake GObject controls
cover cleanup before a later field store and retain before reading the old slot.
An erased-global control keeps the wider declared old type with a managed new
value. The two RC controls in `b6de6ef6e17a` first establish that the native retain
or delayed release is actually inserted, then fail at the omitted old-value
release. Their managed twins require elimination to remain available. Additional
controls check post-call result invalidation and delayed cleanup surviving an
unknown writer and a CFG join. Explicit native retain/release destroy authority.

## Temporal aliases

The existing SCC owner builds a static ceiling from phi edges and carried
sources. It grants nothing. The CFG state carries current alias components:
allocation creates a new identity, simultaneous phi rebinding carries the
predecessor identities, and joins union components. A write invalidates every
current member's slot; publication marks every member reachable. A later read
or unknown call drops published components. Sparse unrelated allocations do
constant work, and component membership occupies linear space.

Each block's state is a finite product of base authority, written slots,
explicit null slots, escape marks and an equivalence partition bounded by the
static ceiling, plus the may-cleanup Boolean. Must joins lose null/fresh authority, accumulate writes and
union aliases. Fixed allocation/store transfers are monotone kills/generations;
phi transfer rebinds all parameters simultaneously. Partition joins have height
at most V-1, and the named base/slot facets have finite O(V*S+V) height. A CFG
worklist runs to equality without a round cap. Interprocedural SCC iteration
adds each return field once and removes each parameter/field once. Compile
counts below test the practical cost against the static version and the
runtime corpus tripwires.

The source guards observe nullable fields through a non-inlined reader. This
deliberately avoids the independent field-read folding defect #998 while
preserving the stores and exact-release assertions that test #916. The frozen
#998 input and successful Node oracle are retained under
`~/.cache/nts-scratch/916/alias-null-observation/`; the initial failed direct
Node flag attempt and its empty stdout are not oracle evidence.

## Source control

`a-fresh-phi-alias-writes-the-original` selects an original object through a phi,
writes a heap reference through that alias, then overwrites the original field.
The heap object is also published so scalar replacement cannot hide a leak.
The old compiler answers 11 and leaks one allocation after collection. The
corrected compiler answers 11 with zero leaks and restores one old-value release.

| compiler source | retains | releases | allocations | leaked | answer |
|---|---:|---:|---:|---:|---:|
| c63dc686e448 | 1 | 4 | 2 | 1 | 11 |
| 00b365281051 | 1 | 5 | 2 | 0 | 11 |

Raw source, commands, emitted code and poisoned harness results are kept in
`~/.cache/nts-scratch/916/phi-source/` and `phi-memory/{before,after}/`.

The low-level phi-alias control failed before alias invalidation and its
field, array and escaping companions pass afterward. All fourteen slot/root
controls passed in `alias-fixed.log`. Four writer controls cover OpenFieldSet,
NativeStore, NativeBitStore and NativeCopy.

## Final managed-memory and count proof

The final full workspace release build at `9f83b35bb49e` is verified by embedded
source digests and covered dep-info for both `nts` and `nts-bench`.

| backend | attempts before | attempts after | effective releases | allocations | leaked |
|---|---:|---:|---:|---:|---:|
| C | 8,227 | 22 | 15 | 15 | 0 |
| LLVM | 8,227 | 22 | 15 | 15 | 0 |

Both products retain 3 attempted null retains. Releases fall from 8,224 to 19,
with null releases falling from 8,209 to 4. The before and after programs return
1 under poison and forced collection. Open Towers keeps the 8,205 pushDisk
attempts for unknown published callers in the C integration control.

| Towers count row | before | after | after/before | improvement | observed band |
|---|---:|---:|---:|---:|---:|
| C | 751,772 | 677,920 | 0.9017628 | 9.82372% | 0.01% |
| LLVM | 735,348 | 645,095 | 0.8772649 | 12.27351% | 0.01% |
| C++ control | 347,332 | 347,329 | 0.9999914 | 0.000864% | 0.01% |
| Node control | 1,151,583 | 1,148,628 | 0.9974340 | 0.256603% | 0.25% |

These are paired `--count` observations. The two native compiler lanes improve
beyond their bands. The C++ artifact hash is unchanged and its count remains
within its band. The Node JIT row is informational and supplies no compiler
speed claim. Other benchmark lanes were not selected for this proof.

All 90 memory minima pass at both their operation and allocation floors, with
zero leaks and unchanged answers. The temporal facet recovers loop-break's
16 and shared-tail's 19 without changing another existing floor.

| source guard | attempted operations | allocations | leaked | answer |
|---|---:|---:|---:|---:|
| phi alias writes the original | 6 | 2 | 0 | 11 |
| distinct-object control | 6 | 1 | 0 | 10 |
| simultaneous phi swap | 6 | 1 | 0 | 11 |
| previous object after new allocation | 25 | 6 | 0 | 206 |
| branch allocation meets an older alias | 13 | 3 | 0 | 37 |

The literal old pin leaks one allocation in the original phi-alias fixture
and the swap guard. Its distinct-object control leaks none. The exact prepared
HIR controls require swap release 1, previous-object release 1 with new-slot
release 0, and branch-join release 1. Poisoned execution and forced collection
are checked separately from these exact static assertions.

`inner.ts --no-agree` passes formatting, Clippy, the fresh build and all selected
core/C/LLVM/JVM tests (4s, 7s, 33s, 590s respectively). All 25 slot/root
controls and both foreign RC controls with their managed twins pass. The view
control also passes. It confirms that existing escape
invalidation already gives up a carried view's source freshness.

## Compile cost

The 34-module runtime and scaling population was compiled in RC and NoGC modes
against `c63dc686e448`, the static-alias owner at `00b365281051`, and the final
owner at `9f83b35bb49e`. The static version also predates the foreign-count
boundary guards: this comparison includes both changes. All 68 rows complete
and remain below their 1.10 instruction-count tripwire, including modules whose
official record is pending. The largest new/old ratio is 1.006759
(RC scalar-replacement scaling); the largest new/static ratio is 1.001537
(RC literal-text scaling). The raw CPU seconds below are process observations
from separate compilations under differing machine load, not wall-time speed
claims. Instruction ratios supply the tripwire decision.

Preparation mode: `rc`. CPU observations are raw process CPU seconds; the 1.10 tripwire is based on instruction counts.

| module | old G | no temporal G | new G | new/old | new/no temporal | new/record | CPU seconds old / no temporal / new |
|---|---:|---:|---:|---:|---:|---:|---:|
| runtime/node/assert | 223.575 | 223.571 | 223.783 | 1.000930 | 1.000947 | pending | 38.64 / 23.44 / 40.53 |
| runtime/node/async_hooks | 3.801 | 3.809 | 3.812 | 1.003001 | 1.000905 | 1.008566 | 0.39 / 0.35 / 0.40 |
| runtime/node/buffer | 6.975 | 6.993 | 6.996 | 1.003089 | 1.000521 | 0.999455 | 1.01 / 0.65 / 0.87 |
| runtime/node/child_process | 307.557 | 307.595 | 307.872 | 1.001027 | 1.000903 | pending | 45.67 / 35.07 / 55.19 |
| runtime/node/cluster | 352.399 | 352.692 | 352.863 | 1.001316 | 1.000487 | pending | 52.96 / 39.42 / 60.45 |
| runtime/node/console | 238.769 | 239.082 | 239.189 | 1.001762 | 1.000446 | pending | 36.67 / 25.86 / 42.45 |
| runtime/node/crypto | 372.281 | 372.658 | 373.007 | 1.001950 | 1.000936 | pending | 44.02 / 40.67 / 63.95 |
| runtime/node/dgram | 323.057 | 323.124 | 323.544 | 1.001510 | 1.001302 | pending | 40.91 / 34.28 / 56.45 |
| runtime/node/diagnostics_channel | 3.097 | 3.104 | 3.106 | 1.002632 | 1.000648 | 1.041103 | 0.34 / 0.30 / 0.38 |
| runtime/node/dns | 15.878 | 15.914 | 15.919 | 1.002587 | 1.000269 | pending | 1.53 / 1.49 / 2.25 |
| runtime/node/events | 215.989 | 216.215 | 216.433 | 1.002053 | 1.001004 | pending | 24.91 / 23.57 / 35.83 |
| runtime/node/fs | 431.960 | 431.972 | 432.191 | 1.000533 | 1.000507 | pending | 55.14 / 50.13 / 77.55 |
| runtime/node/http | 445.284 | 445.346 | 445.484 | 1.000449 | 1.000309 | pending | 54.24 / 49.21 / 87.61 |
| runtime/node/net | 324.114 | 324.437 | 324.455 | 1.001050 | 1.000054 | pending | 38.84 / 34.85 / 60.76 |
| runtime/node/os | 7.315 | 7.333 | 7.334 | 1.002522 | 1.000065 | 0.999811 | 0.79 / 1.04 / 0.99 |
| runtime/node/path | 8.112 | 8.134 | 8.126 | 1.001724 | 0.999022 | 1.011497 | 0.79 / 0.74 / 1.10 |
| runtime/node/perf_hooks | 243.738 | 244.047 | 244.213 | 1.001948 | 1.000678 | pending | 34.77 / 25.99 / 45.54 |
| runtime/node/process | 436.797 | 437.466 | 437.489 | 1.001585 | 1.000054 | pending | 45.94 / 46.89 / 94.63 |
| runtime/node/punycode | 0.803 | 0.804 | 0.804 | 1.000879 | 0.999659 | 1.006363 | 0.10 / 0.10 / 0.13 |
| runtime/node/querystring | 8.107 | 8.124 | 8.123 | 1.002058 | 0.999904 | 0.998579 | 0.88 / 0.75 / 1.38 |
| runtime/node/readline | 255.872 | 255.980 | 256.184 | 1.001221 | 1.000800 | pending | 27.96 / 26.71 / 54.18 |
| runtime/node/stream | 295.022 | 295.362 | 295.341 | 1.001080 | 0.999928 | pending | 30.52 / 30.59 / 60.62 |
| runtime/node/string_decoder | 7.054 | 7.061 | 7.067 | 1.001797 | 1.000785 | 0.997572 | 0.64 / 0.70 / 1.23 |
| runtime/node/timers | 5.585 | 5.600 | 5.601 | 1.002811 | 1.000162 | 1.015068 | 0.60 / 0.49 / 1.12 |
| runtime/node/tty | 0.051 | 0.051 | 0.051 | 1.000177 | 0.999890 | 0.991149 | 0.01 / 0.01 / 0.01 |
| runtime/node/url | 26.857 | 26.927 | 26.898 | 1.001515 | 0.998917 | 1.002722 | 2.47 / 2.62 / 4.57 |
| runtime/node/util | 228.988 | 229.021 | 229.217 | 1.001000 | 1.000857 | pending | 22.68 / 23.48 / 44.76 |
| runtime/node/zlib | 401.374 | 401.584 | 401.735 | 1.000900 | 1.000375 | 1.057377 | 64.87 / 41.70 / 66.42 |
| runtime/web-platform | 259.545 | 259.581 | 259.699 | 1.000595 | 1.000456 | pending | 40.23 / 27.04 / 43.57 |
| tests/compile-time/escape-analysis-scaling | 2.247 | 2.254 | 2.256 | 1.003820 | 1.000534 | 0.796192 | 0.17 / 0.21 / 0.26 |
| tests/compile-time/evolved-type-scaling | 1.246 | 1.250 | 1.247 | 1.001454 | 0.997879 | 1.009164 | 0.11 / 0.12 / 0.18 |
| tests/compile-time/length-fold-scaling | 7.803 | 7.829 | 7.824 | 1.002714 | 0.999386 | 0.984020 | 0.59 / 0.69 / 1.21 |
| tests/compile-time/literal-text-scaling | 14.982 | 15.046 | 15.069 | 1.005804 | 1.001537 | 1.054142 | 1.89 / 1.60 / 2.90 |
| tests/compile-time/scalar-replacement-scaling | 10.089 | 10.161 | 10.157 | 1.006759 | 0.999570 | 1.066466 | 1.12 / 1.03 / 2.16 |

Preparation mode: `nogc`. CPU observations are raw process CPU seconds; the 1.10 tripwire is based on instruction counts.

| module | old G | no temporal G | new G | new/old | new/no temporal | new/record | CPU seconds old / no temporal / new |
|---|---:|---:|---:|---:|---:|---:|---:|
| runtime/node/assert | 205.247 | 205.209 | 205.222 | 0.999879 | 1.000062 | pending | 43.26 / 29.33 / 29.65 |
| runtime/node/async_hooks | 3.315 | 3.316 | 3.315 | 0.999996 | 0.999903 | 1.007986 | 0.64 / 0.29 / 0.34 |
| runtime/node/buffer | 6.315 | 6.316 | 6.315 | 1.000002 | 0.999941 | 1.005303 | 1.17 / 0.61 / 0.66 |
| runtime/node/child_process | 281.909 | 281.853 | 281.908 | 0.999994 | 1.000195 | pending | 61.12 / 44.46 / 45.60 |
| runtime/node/cluster | 324.526 | 324.516 | 324.532 | 1.000018 | 1.000050 | pending | 71.30 / 53.84 / 48.19 |
| runtime/node/console | 219.492 | 219.511 | 219.480 | 0.999943 | 0.999857 | pending | 46.53 / 34.38 / 31.88 |
| runtime/node/crypto | 339.793 | 339.946 | 339.818 | 1.000074 | 0.999624 | pending | 75.14 / 58.38 / 56.89 |
| runtime/node/dgram | 297.201 | 297.181 | 297.149 | 0.999827 | 0.999894 | pending | 64.95 / 46.08 / 44.10 |
| runtime/node/diagnostics_channel | 2.743 | 2.742 | 2.743 | 0.999995 | 1.000564 | 1.043862 | 0.56 / 0.46 / 0.32 |
| runtime/node/dns | 14.181 | 14.172 | 14.181 | 1.000002 | 1.000649 | pending | 2.72 / 2.31 / 1.65 |
| runtime/node/events | 198.247 | 198.474 | 198.247 | 1.000000 | 0.998855 | pending | 41.25 / 35.09 / 28.70 |
| runtime/node/fs | 392.848 | 392.865 | 392.844 | 0.999990 | 0.999945 | pending | 86.66 / 73.63 / 61.55 |
| runtime/node/http | 409.064 | 409.093 | 409.184 | 1.000292 | 1.000223 | pending | 79.99 / 78.13 / 68.56 |
| runtime/node/net | 297.429 | 297.236 | 297.411 | 0.999940 | 1.000589 | pending | 59.88 / 56.42 / 48.14 |
| runtime/node/os | 6.579 | 6.579 | 6.579 | 1.000006 | 1.000001 | 1.005107 | 1.25 / 0.63 / 0.93 |
| runtime/node/path | 7.557 | 7.553 | 7.557 | 1.000001 | 1.000470 | 1.009701 | 1.29 / 0.80 / 1.15 |
| runtime/node/perf_hooks | 223.902 | 223.805 | 223.842 | 0.999732 | 1.000168 | pending | 43.54 / 41.45 / 37.97 |
| runtime/node/process | 401.986 | 401.604 | 401.911 | 0.999814 | 1.000765 | pending | 72.53 / 65.98 / 58.17 |
| runtime/node/punycode | 0.776 | 0.776 | 0.776 | 0.999994 | 1.000568 | 1.003830 | 0.09 / 0.12 / 0.10 |
| runtime/node/querystring | 7.371 | 7.366 | 7.371 | 1.000000 | 1.000688 | 1.005412 | 1.11 / 1.17 / 1.08 |
| runtime/node/readline | 235.187 | 235.271 | 235.200 | 1.000056 | 0.999699 | pending | 39.92 / 38.32 / 29.26 |
| runtime/node/stream | 270.580 | 270.484 | 270.586 | 1.000022 | 1.000377 | pending | 45.25 / 48.16 / 33.48 |
| runtime/node/string_decoder | 6.393 | 6.397 | 6.393 | 1.000008 | 0.999413 | 1.003976 | 0.73 / 0.85 / 0.67 |
| runtime/node/timers | 4.726 | 4.726 | 4.726 | 0.999999 | 1.000194 | 1.011004 | 0.49 / 0.51 / 0.49 |
| runtime/node/tty | 0.050 | 0.050 | 0.050 | 0.999835 | 0.999725 | 1.004562 | 0.01 / 0.01 / 0.01 |
| runtime/node/url | 25.107 | 25.107 | 25.108 | 1.000035 | 1.000030 | 1.003365 | 2.88 / 3.43 / 2.56 |
| runtime/node/util | 210.147 | 210.158 | 210.157 | 1.000051 | 0.999999 | pending | 36.05 / 27.41 / 25.75 |
| runtime/node/zlib | 369.945 | 369.798 | 369.923 | 0.999939 | 1.000336 | 1.051269 | 68.60 / 50.76 / 44.84 |
| runtime/web-platform | 239.912 | 239.622 | 239.869 | 0.999820 | 1.001030 | pending | 42.02 / 33.69 / 27.88 |
| tests/compile-time/escape-analysis-scaling | 1.520 | 1.520 | 1.520 | 0.999978 | 0.999915 | 0.960309 | 0.17 / 0.13 / 0.16 |
| tests/compile-time/evolved-type-scaling | 1.225 | 1.224 | 1.225 | 1.000011 | 1.000102 | 1.006259 | 0.15 / 0.12 / 0.16 |
| tests/compile-time/length-fold-scaling | 7.446 | 7.446 | 7.446 | 1.000000 | 1.000029 | 0.979472 | 0.95 / 0.63 / 0.69 |
| tests/compile-time/literal-text-scaling | 13.209 | 13.211 | 13.209 | 1.000049 | 0.999855 | 1.041503 | 2.56 / 2.08 / 1.25 |
| tests/compile-time/scalar-replacement-scaling | 8.914 | 8.953 | 8.914 | 1.000007 | 0.995641 | 1.041644 | 1.55 / 0.99 / 0.98 |


## Mechanism counterfactuals

The committed native-count mechanism was disabled only after the final owner
commit existed. Three foreign controls then failed at their old-value release
assertion, after their actual native-count witnesses passed. The exact source
was restored from its saved bytes. The managed twins pass with the mechanism
enabled. `foreign-disable/result.json` records the failing cells and restoration.

Disabling only the early prune makes the closed-entry root assertion fail.
Unknown, open and EveryExport core views remain byte-identical; Entry has the
expected unreachable adapter absence. The complete corpus isolation below
checks the same distinction in prepared C and LLVM products. Source restoration
is byte-checked. Neither counterfactual is production code.

## Prepared-HIR census

The final corpus is 42 projects, each captured in C and LLVM, RC and NoGC,
and EveryExport, open and explicit Entry preparations. Before, after and
no-early-prune compilers provide two comparisons for each of the 504 views.
Every stderr population is byte-identical. Every NoGC view is byte-identical.
The comparison validates derived metadata digests and SSA references before
normalizing them; surviving function headers and operations must otherwise
match after identifying individual old-value load/release pairs. Raw roots,
actual compiler hashes, captures and per-operation inventories are retained.

| comparison | views | byte-identical views | old loads removed | releases removed | old loads restored | releases restored | Entry adapters absent | unexplained |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| c63dc686e448 → final | 504 | 328 | 758 | 758 | 36 | 36 | 188 | 0 |
| final without early prune → final | 504 | 470 | 2 | 2 | 0 | 0 | 188 | 0 |

The whole-change removals are 756 constructor pairs and two Towers pairs.
The constructor sites are fields 0, 1 and 3 in the private whole forms of
`ERR_STRING_TOO_LONG#constructor` (including its raising form), whose callers
supply an empty receiver. Repeated products and runtime module inclusions
account for their multiplicity. Towers removes `disk.next` cleanup in its
consuming pushDisk in the two closed Entry products. These are all null-slot
old-value loads and releases; no other surviving operation changes.

The 36 restored pairs are six source sites, each in C and LLVM across the three
RC root views: the original phi alias fixture's `work`; the swap fixture's
`work` and `work#whole`; and the program control's `installMaybe`,
`installAliased` and `aliasParameters`. They respectively demonstrate a write
through a phi alias, simultaneous phi rebinding, a normal-return path retaining
a reference, a call that mutates the slot, and two parameters that can alias.
The old flat scans answered incorrectly at these sites. The source leak guards
and exact HIR controls tie each restored release to the corrected owner.
There are no additional corpus restores from the foreign-boundary extension;
its effects are proved by the dedicated foreign controls and managed twins.

The prune isolation changes no open or EveryExport byte (336 views), no NoGC
byte (252 views), and no diagnostic. Its only surviving operation change is
the Towers pair in the two RC Entry products. All 188 absent functions in each
comparison are simple borrowed adapters consisting of parameters, counts,
one call and return; each calls a consuming target still present afterward.
No function is added, and no other function body changes. Unknown-root identity
is additionally checked by the core four-root control. This establishes that
later passes retain the source functions they need.

Crypto's generic entry names include commas, which the ordinary comma-delimited
CLI cannot transport. A measurement-only literal JSON root-vector patch was
applied identically to the before and after pins. Twelve representative views
per version are byte-identical to the plain CLI before those pins are used.
The no-prune pin combines that same transport with only the approved prune
line disabled. Exact patches, compiler hashes and build logs are retained;
none of the transport or disable edits is submitted. The approved three patched
pins are deleted after this census is recorded, retaining their provenance.
The plain final pin remains for test262.

## Standalone source agreement

The supported `runCheck` owner uses the gate's canonical environment and sealed
Node oracle capability. The six fixtures and shared fixture config are copied
byte-identically outside the pending-record population, with input hashes, so
every cell executes its complete positive population. Every cell has a complete
oracle, zero refusals, runtime declines, timeouts, aborts and disagreements.
The matrix contains 1,276 compared cases in 24 cells; no pending zero-case exit
is counted. JVM uses its host GC; native NoGC and C RC modes are explicit.

| fixture | C NoGC | LLVM NoGC | JVM | C RC |
|---|---:|---:|---:|---:|
| `a-field-cleared-before-a-call-keeps-no-old-reference` | 174/174 | 174/174 | 174/174 | 174/174 |
| `a-fresh-phi-alias-writes-the-original` | 29/29 | 29/29 | 29/29 | 29/29 |
| `a-fresh-phi-alias-writes-the-original-control` | 29/29 | 29/29 | 29/29 | 29/29 |
| `a-phi-swap-keeps-the-overwritten-release` | 29/29 | 29/29 | 29/29 | 29/29 |
| `a-new-allocation-leaves-the-old-alias-occupied` | 29/29 | 29/29 | 29/29 | 29/29 |
| `a-branch-allocation-meets-an-older-alias` | 29/29 | 29/29 | 29/29 | 29/29 |

Core-only fake foreign-counted handle cases are structural HIR controls and have
no executable TypeScript or Node claim. Every executable source fixture is in
`tests/programs` or `tests/memory` and appears in the matrix above.

## Native poison and collection cells

Each of the five memory fixtures is additionally emitted and executed in C RC
and LLVM RC with `NTS_POISON` and operation counting. The production memory
harness explicitly collects before and after `work(1)`, then checks the live
allocation count. This is explicit forced collection at those boundaries,
not a claim of collection after every allocation. All ten cells pass:

| fixture | C RC poison + collection (attempts / allocations / leaks) | LLVM RC poison + collection (attempts / allocations / leaks) | answer |
|---|---:|---:|---:|
| `a-fresh-phi-alias-writes-the-original` | 6 / 2 / 0 | 6 / 2 / 0 | 11 |
| `a-fresh-phi-alias-writes-the-original-control` | 6 / 1 / 0 | 6 / 1 / 0 | 10 |
| `a-phi-swap-keeps-the-overwritten-release` | 6 / 1 / 0 | 6 / 1 / 0 | 11 |
| `a-new-allocation-leaves-the-old-alias-occupied` | 25 / 6 / 0 | 25 / 6 / 0 | 206 |
| `a-branch-allocation-meets-an-older-alias` | 13 / 3 / 0 | 13 / 3 / 0 | 37 |

## Five test262 records

The clean official pin of `9f83b35bb49e` runs the five C recorded populations
through `conformance262.ts --under <dir> --recorded <tsv>`, admitted under
`test262-records`. All reconcile without record drift; no result rows are
hand-written or changed by this task.

| population | pass-count | negatives accepted | status |
|---|---:|---:|---|
| test/language | 7014 | 1315 | reconciled |
| test/built-ins | 888 | 185 | reconciled |
| test/annexB | 9 | 1 | reconciled |
| test/staging | 54 | 3 | reconciled |
| test/harness | 17 | 0 | reconciled |

## Exact-commit gates

The implementation's complete inner run at `9f83b35bb49e` is recorded above.
After this evidence commit, the final `inner.ts --no-agree` and exact-commit
`check.ts --here` results, with selected and deferred steps, are reported in
Signalbox's readiness message. The standalone agreement matrix above supplies
pre-landing Node evidence independently of the landing check's time-budget
selection. This task does not queue its own landing.

## Retained evidence

Raw outputs remain under `~/.cache/nts-scratch/916/`. The following hashes bind
the decision-relevant reports. The census decision report additionally binds
every per-project report, whose before/after hashes bind each HIR capture and
diagnostic; its classified inventory contains every changed operation and
removed adapter. The test262 summary binds each population log. Pin provenance
retains exact patch and build-log hashes after the three authorized patched
pins are deleted. The plain pin is retained.

| file relative to scratch/916 | SHA-256 |
|---|---|
| `after-release/provenance.json` | `3f854a1a969a135807525df86a4e9b1a70a8ce5015bcdc3d85603c501297a653` |
| `before-release/provenance.json` | `c74b0d87e886d28e6ed1553f6a92b5e2016b6459b4da99f284840c9d68d5db37` |
| `inner-native-2.log` | `ef01bdba5e769bf66a6582a8d7064f3120b519fcb9eacc28485be5a1353e5043` |
| `inner-native-summary.json` | `5bd913b3c288e98796a7e23cb1ca94148b75428d9e1936f59f2c4d7da6febcbe` |
| `memory-native.log` | `d9b9dbbccd94d3d58534aa4436e707f033f7a532b3ca22c35f7ad20da29f84b5` |
| `towers-memory/summary.json` | `d79c859bb5872506c06d4169913aa00fd3720a4b68706d7cd7f90244022ce44f` |
| `guard-final-census.json` | `117441d03fc28f637c4f5b2be353c18245da85a4bf33e5fddd96a7fccc64e539` |
| `minima-final-all.log` | `4d3920ac841defedf1462631129db3d6c66734af44850e2e4d574e2415a3423f` |
| `minima-final-loop-break.log` | `2669648c27bea0d403d61fa3081f0b283eee0ae7e15cc5f02ec68c2aed212a61` |
| `minima-final-shared-tail.log` | `3f8f509760317401ff8663d181a88a4c42d26d7bfd5cacf14a029b134ee02bd0` |
| `counts/summary.json` | `5def3aa8c8b06c976e7ddac21649c37f44a025796f3cb431e5a30ccedc1fc012` |
| `counts/comparison.json` | `409cfb274296757ae48e408787b72ac50e3c048d03d48b4f7bbeea97c79f4089` |
| `compile-cost/per-module.json` | `87b04efbc2719cfc0c35e4ec815ba697af6e4b29966301d71ffcbdea931cb7b6` |
| `compile-cost/tripwire-summary.json` | `46c70bd5f7908a2db45fa319863d09b2a4e2f12141bb705db654c4b124fcb20f` |
| `hir-compare-native/inputs.json` | `53da07d1f7c65344c0f3eb2aafbe296a567e5a449446a7f6e534663249e1e8eb` |
| `hir-compare-native/decision-summary.json` | `7ad6bf83ed51e9ede67555d2945466aac00908f8c162351ba7ba42f04252cbad` |
| `literal-equivalence-before/summary.json` | `24cd960808be4851beb92fa6e178a525e7e5741b50058a23d5bd095acecdb091` |
| `literal-equivalence-after/summary.json` | `fce77558cb54ef41b595ed65e709e28bbaa03c872b6de31e7ee2f7ef54bcb4d8` |
| `prune-control/comparison.json` | `8d7d5ecb5979345ec5dc82693197960e7ae34241e509f451c7c27f2fd2df3726` |
| `prune-proof/summary.json` | `b104bcb3d5eec879f7932ac788121f26a7294a9b1b3068886f4655f51dbb5aba` |
| `foreign-disable/result.json` | `c520d0e6e0ae12f6cf47720acb4a96b7451c560cbf8d93df4d60d16db71fb962` |
| `patched-pin-provenance/manifest.json` | `1bf7de3dc2e4c4b7b2ef3a9b62a2243d446e0f9609632c9e756c3491c0192403` |
| `agreement-complete/inputs.json` | `fa76dbafb5fb249721f21ee236b3a78c3f4a77c0b90241d48032e9b4270faa07` |
| `agreement-complete/summary.json` | `b6f875ece78e79a5e2c492ca8c4f4fc92c0b5601c117b43ee740565da33e5a2e` |
| `agreement-complete/complete.json` | `7b0d4d40015be97f2975d38a1c7831a7487dc393ad2dcd0ee4648c142fbc0eef` |
| `llvm-guard-poison/summary.json` | `1dc2b323be86a8da65423b098c998389895653278a50dfd1e0b935ffad0f0f9e` |
| `test262-final/summary.json` | `72115c1cf6ab5d328cb3fe0edcdacb34570ca8e55495f91d19b1a4d18eb306e6` |
| `guard-census.json` | `7f465d9731b6862672a299812075a0d8e61c31f977f02d7a5120cc80e03b94ab` |
| `native-boundaries/summary.json` | `849cdca7c5e15ec90935d7cfb02e828415bad5cceb12dbb4e456f8fd9b4c8b62` |
| `phi-memory/before/summary.json` | `73046d076d1d76afdf94093c629507dab62538af25f6df709c4f2ec039dc4703` |
| `phi-memory/after/summary.json` | `1ce34c303e9735c49b487ffa30b088a44c863cbd9a7fda2f3caaf51e2bc6411e` |
