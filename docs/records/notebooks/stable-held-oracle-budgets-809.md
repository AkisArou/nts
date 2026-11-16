# Stable held oracle budgets

Fixes #809. Only the held jetstream budget converts. The 1,229 measured rows and
the no-oracle JSX row retain exact bytes. No Node oracle is re-executed for the
conversion.

Two consecutive oracle-family records-route refreshes, each invoking a child
with the actual recordAll/writeRecords owners, supply [32.8,33] and [33.8,37]
CPU seconds at one producer. The shard bytes remain exact and both accepted
deltas contain zero rows; distinct raw CPU evidence is retained.

## Contract

Budget version 2 persists phase, outcome, bound and signal. Raw CPU observations
and error transcripts stay in run evidence. Margin production still requires
two completions within the bound, with at least one past half; persisted margins
require execute and no signal. TypeScript and native readers accept v2 only.
An unchanged classification and revision retain the row including its recording
provenance. Changed classification remains visible through the family audit.

BudgetRevision alone replaces installer implementation provenance with validated
runtime package content. Catalog acquisition still verifies all recipe and input
pins; its mode-normalized content hash uses the sealed image's single mode rule
and canonical path order, excluding installer bookkeeping. Actual source-catalog
and inner sealed-image projections match over 1,082 entries. Global oracle/seal
identities and measured-row driver identity construction are unchanged.

## Provenance premise

| Reader/owner | Meaning |
| --- | --- |
| oracle-records.ts parseRow/writeRecords | Driver digest grammar and serialization; revision allowed only on budget rows |
| record-oracles.ts identity/withRow/writeTable | Records driver provenance; never uses measured driver digest to request refresh |
| oracle-record-family.ts oracleRefreshes | Only budget/unplanned revision comparison; measured rows never enter it |
| oracle-record-family.ts audit | Whole-row transport/ratchet integrity, not recomputed driver freshness |
| oracle-record-identities.ts | Driver field explicitly recording provenance; tree checks source/domain only |
| native oracle_records.rs | Reads JSON population records, does not inspect driver or revision.producer |
| native oracle_coverage.rs validate | Matches source/backend key and complete generated count; foreign driver passes, wrong count refuses |

Generic recorder snapshot/delta serialization preserves the whole row; it grants
no freshness meaning to a driver digest. A measured row cannot carry revision at
all. Raw finding driver_sha256 is a different, per-run diagnostic field.

## Census

The current-main normal planner census completes 1,231 configs / 3,693 plans
with zero failures. All 1,231 population signatures/case digests/counts/backend
bindings reproduce. Only the held row reproduces old driver + revision exactly;
1,230 other rows have different recording driver provenance. This is why mass
retirement would be wrong. The no-oracle reason remains explicit and unchanged.
The separate RC phase is setup refusal, not an RC result. Its dead-holder trace
is #813: the first sibling command owns/closes the holder but leaves metadata
that the next unsealed sibling tries to consume as live. No Node replacement
is inferred and no session guard changes here.

## Migration and scope

The conversion requires exact authenticated old shard bytes, validates the old
margin's classification, keeps entry/Node/policy, derives v2 producer and writes
through writeRecords. A later records commit moving the old shard requires a
fresh conversion after rebase, never a JSON hand merge.

The wider race is observed: a branch carrying regenerated rust-runtime.json
can race any records commit that touches a selector input. Churn made it common.
Whether landing should derive that record for its rebased candidate is an open
design question, out of scope. The accepted selector is inherited unchanged;
#798 owns the next canonical refresh.

## Proof and cost

| Evidence | Actual result |
| --- | --- |
| Final affected controls | Strict 0; parser/identity 16/16; runtime-package and repeated-record route 3/3; family audits 2/2; timing/host audits 0 |
| Prior plan decoder, read-only | The new plan-memory-cap negative fails by its exact missing-refusal assertion; fixed passes |
| Tampered conversion input | Exact-shard guard refuses, bytes unchanged |
| Fresh inner at `22d2af672b` | fmt 6 s, Clippy 198 s, build 18 s, tests 763 s; 809 Rust tests passed, none failed/ignored |
| Retained inner binding | All 1,691 Rust/Cargo/toolchain facts and 367 literal embeds exact at `2d52f0fd85`; all 954 captured dependency files exclude later changes |
| Final supported at `2d52f0fd85` | 20/20 PASS including build; native 3,079/0/8 ignored; frontend 7 files, no failures/unavailable; tooling 2,826/0 with 2 existing Unicode TODOs |
| Supported finalization | Canonical, no experiments, clean tree; cleanup and diagnostics complete; green temporary removed; command 0/null and unit inactive-success |
| Exact-tip readiness | Separate receipts bind the final Markdown tip |

The final plan-classification correction changes only TypeScript files; no Rust,
Cargo or embedded input moved after inner. Its proof remains at its actual
source, carried by byte/dependency equivalence, rather than relabelled as a
later run. The post-#797 conversion and tooling row were regenerated by their
writers; no JSON was hand-merged. The tooling test diagnostic count fell from
15 to 14. The sole budget conversion preserves entry, Node and policy and all
1,231 other JSON files; that includes the 1,229 measured rows, no-oracle row
and generator header.

The actual pre/post-#797 identity facts isolate the cause. Using the old
algorithm on those facts changes the budget producer from `7ff437fe…` to
`39fa1d27…`. The new algorithm produces `f76157d0…` in both arms, with identical
runtime package content. This comparison consumes frozen identity facts and
runs no oracle. The two records-route refreshes additionally hold both shard
bytes and zero-row deltas exact under distinct supplied CPU samples.

Supported's owner reported 725.030 s; its runner 707.382 s; the whole CLI took
841.921 s including selection. Tooling took 359 s and gate-inputs 226 s.
Normal memory admission is included in the observed inner phase times. These
are costs under concurrent machine load, with no speed or bound claim. The
post-test incremental cleanup removed only this tree's regenerable
`target/nts-dev/incremental` (15,071,708,834 logical bytes).

## Exclusions and receipts

V1 strict stopped before controls on a missing test import and unused callback;
V2 and the final post-rebase V3 passed. The old-source negative is an expected
RED, not a fixed-source verdict. The normal census completed; its separate RC
setup refusal is #813 and no RC result is inferred. A preliminary metadata
comparison omitted its explicit TypeScript location and refused before the
comparison; the final comparison uses the supported report's location.

The inner receipt wrapper's mistyped label `3e069dc` is retained as raw data;
it is not an execution input. The clean actual source was independently bound
to `22d2af672b` while it ran. An initial supported count-extraction draft used a
Cargo-line pattern; the final verification reads the test owner's aggregate
summary. Neither draft changes a run's verdict. A broad formatting command's
unrelated vendored edits were restored before commit, with no retained vendor
delta. No private full-tooling launcher or repeated whole peer proof was used.

The accepted `rust-runtime.json` stays byte-identical to main. It is allowed
to be conservatively stale-live; #798 owns the next canonical refresh. No
selector guard, history, bound, cache or deletion policy changes here.

Finite raw evidence: `~/.cache/nts-scratch/809/raw-evidence-v1.json`, SHA-256
`80d1c74d7f0306d634a92470230921d2f7966486f06759564f657a0b3ff82dfa`. It binds 2,196 artifacts /
137,769,394 bytes and 4,030 Git facts,
including explicit absent-new-record facts. The raw manifest binds normal
plans, migration and identity comparisons, source/dependency facts, original
and fixed controls, inner and the supported owner result. Exact-tip readiness
and finite peer authentication have separate receipts in the same kept scratch.
