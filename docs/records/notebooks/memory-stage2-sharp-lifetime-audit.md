# Stage-2 sharp lifetime observations on d737

This observation audits the retained sharp sample after the actual-caller
comparison prerequisite landed at `d737698837e4f4b2f45595ab7163cb516a4e3f80`.
The sample contains 44 configurations of 11 registered projects, using C and
LLVM with NoGC and RC. It is not the full registered population. The reports,
prepared HIR and complete own-backend emissions are the already retained exact
source observations; this audit adds source and lifetime reasoning, with no new
runtime execution or placement change.

All 160 sharp observations are stage-2 precision gaps. No lifetime defect is
proved on these inspected paths. This conclusion does not certify other main
placements, a full population, or a placement consumer.

| Group | Observations | Actual lifetime evidence | Missing fact |
|---|---:|---|---|
| Frame / Outside | 16 | Four sites, each in four configurations. The closed paths use pointer truth, presence checks or a closure returning a scalar. No reference escapes through a store, callback or managed return. | Pure-read storage and retention contracts, including truth and presence operations. |
| Call-region / OutlivesFrame: numeric sort | 128 | The four header/growth sites in `ascendingByIndex` return numeric arrays into a caller-owned region. Callers read lengths and f64 elements before the actual reset; no reference view, store or callback carries the result onward. | Caller-owned allocation scope and the caller's actual last-use/reset frontier, covering backing storage too. |
| Call-region / OutlivesFrame: sigma string | 8 | The final join in `Closure0#call` allocates a fresh string. Caller appends copy its units before region reset, including the case where that string is the right operand. | Caller-owned allocation scope, copy effects and reset frontier. |
| Call-region / OutlivesFrame: joined rows | 4 | The final join in `show` returns a fresh string, copied by the caller's append before reset. | The same allocation-scope, copy and frontier facts. |
| Frame / RuntimeRootContract | 4 | One entry tuple enters only a temporary array. Map insertion receives its literal-string and scalar fields, never the tuple or array. No candidate, holder, global or escaping owner reaches that temporary graph. | Field-level escape and actual collector-root reachability, rather than an unconditional root for every reference-bearing array. |

## Why the region rows are precision gaps

The region's storage is owned by its caller, not by the allocating callee's
stack frame. The stage-2 lifetime witness correctly follows a return into that
caller, but its current home proposal cannot discharge the corresponding
caller-owned region frontier. These 140 observations are not evidence of a
read after region reset.

`nts_region_end_call` suspends TLS allocation routing; it does not free region
blocks. The actual invalidation is release of the counted region handle after
its last hold, through the boxed destructor into `nts_region_reset`. The audit
joins actual ContextIds, call ValueIds and physical variants, rather than
inferring ownership from names. All 28 distinct inspected parent geometries
have no result use after reset and reset before every reachable normal return.

For strings, `nts_array_join_str` allocates and copies, rather than returning
an input alias. A region string's IMMORTAL count prevents consuming append's
`reserved == 1` reuse. After suspension, a left region operand is copied into a
fresh heap string; right operands are copied into the result too. Both operand
reads and copy completion precede actual reset. IMMORTAL is not itself a
lifetime-extension proof.

Closed actual callee and runtime paths supplement the normal CFG walk. The
sigma radix guard and its unreachable uncaught branch remain explicit; no
general exceptional or NoRaise permission is inferred. These observations do
not discharge #18's exceptional-edge obligations elsewhere.

## Why the collector rows are precision gaps

The tuple and its temporary array have acyclic descriptors, but that alone
would not suffice: a cyclic candidate can trace through an acyclic child.
The complete use inventories also exclude any incoming candidate or holder
edge. The global map acquires only the tuple's literal string and number.
On RC, the actual array/backing release precedes frame cleanup and return.
NoGC leaves only unreachable bytes with no later access. Stage 2 currently
exposes every reference-bearing array to a collector root and propagates that
root through its element to the tuple.

## Retained packets and review

All paths below are under `~/.cache/nts-handover/`.

| Packet | SHA256 |
|---|---|
| `compiler3/exceptional-transfer-18/sharp-inventory-d737-r1/inventory.json` | `3e34bc983147d77e7bd62ae5e58982b38344f0763b238d427f4888e40508022a` |
| `compiler3/exceptional-transfer-18/sharp-outside-frame-audit-d737-r1/audit.json` | `d27fcdf388c3c1a08f9ddc045627ea349bde501abcdbbae52fe33fcd8317f5cc` |
| `compiler3/exceptional-transfer-18/sharp-call-region-audit-d737-r1/audit.json` | `5f558b419718d8771d693a899f08d88d198f84ba9e4ea8efe501d0fdf860fe1c` |
| `compiler3/exceptional-transfer-18/sharp-collector-audit-d737-r1/audit.json` | `fe24c8bc4de52d557ff1f3d297556b83525c71c81a9a01e2af3ced2e2f7f686c` |
| `compiler4/sharp-d737-frame-outside-review-r1/review.json` | `cd7fa417ccd849f7b25b5a6e4fddb1abb8849c5f0f47145cea1a067e334b7c53` |
| `compiler4/sharp-d737-call-region-review-r1/review.json` | `cdff6ca01faad61e68f54a48a4fa58e0bb1f57d8069704bacdb88e2765f9034c` |
| `compiler4/sharp-d737-collector-review-r1/review.json` | `90d49c5ed7f94a6e9dc1b8cb8ec6a4301672c7f0047c6d3e35e222a5bec494e5` |

The compiler4 receipts independently clear these classifications only. The
caller-owned allocation scope/reset frontier (140) and field-level collector
escape (4) remain named producer-plan obligations, alongside the pure-read
contracts (16). Each must be discharged before memory can drive placement;
explaining a precision gap does not waive it. The zero frame-to-heap rule in
the exceptional-transfer design continues to apply against the corrected
actual parent. A later census must retain these explanations by actual site,
context and variant, while preserving every unresolved or Unknown row.
