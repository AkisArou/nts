# Independent recorder families (#803)

The same recorder bodies pass 34 tests before and 34 after the extraction,
covering all nine families. Their 128 captured events are byte-identical over
1,052,246 bytes, including record strings, delta strings and exact messages.
The capture normalizes private temporary identities and sorts Map entries.
This is same-input replay evidence, not a timing comparison.

The complete production recorder is now one composition table over a generic
transaction core and nine independent family handlers. This lets a fixture of
one family stage that family while retaining its truthful input declarations.
It unblocks #719's type-checks handler without making every other recorder
fixture carry the tooling TypeScript Program. Record formats, family order,
accepted changes, pending rules, source checks and ratchets remain the same.
The Rust selector family stays last for the separately assigned self-consistent
records submission work.

## Ownership and callers

`recorder-core.ts` owns snapshots, rollback, generic audits, source digests and
delta transport, with no family or parser imports. Each `*-record-family.ts`
owns its population, format, writer and merge rules. Compile-time table/evidence
pairing remains atomic. `record-pending.ts` is the sole production family table.
Command entries call `withPreparedOracle` visibly and pass the supplied sealed
environment to `recorder-command.ts`, which owns the existing supervised runner
and never prepares. Invalid arguments and pure apply modes remain outside that
preparation boundary.

| Consumer | Before | After |
|---|---|---|
| Full-check records/service | Complete recorder entry | Same complete production entry |
| `record-pending.test.ts` | Dispatcher and aggregate population | Actual composition; core types and direct refresh/identity owners |
| `record-pending-outcomes.test.ts` | Whole tooling namespace and dispatcher | Outcomes entry, core/command and original preload project inputs |
| `run-recording.test.ts`, `run-outcomes.test.ts` | Dispatcher for run audit | Core plus run handler |
| `oracle-record-identities.test.ts` | Aggregate population | Core plus oracle handler |
| `summary.ts` | Aggregate population | Four rendered pending families and pure path metadata |
| Report-consumer/census tests | Direct producer commands | Unchanged; no dispatcher runtime import |
| Population-input fixture | Unrelated entry stub | Unchanged; no dispatcher runtime import |

The actual composition/drop-family controls retain the production table. The
moved outcome predicates take `Pick<OutcomeTransition,'word'>`; the caller
explicitly refuses the existing pre-ratchet branches before using that finite
vocabulary. Exact-message negatives and an improvement control preserve those
answers. Replay V1 found only Pending property ordering differed, so the core
restores the original explicit `{kind,name,record}` projection; later complete
replays are byte-equal.

## Reproducing a preload's real projects

`copyFixtureProject` is shared by the outcomes and compiled-axis fixtures. Its
initial project requires plain JSON, explicit files, an empty include and no
project references. It fences containment, ancestry and regular-file identity
before reading, captures each config once, decodes JSONC ancestors through the
pinned SDK over captured bytes, and requires placed config bytes to equal those
captures. Package, missing, cyclic and escaping inheritance refuse by name.
The entries-getter mutation control proves newer config bytes cannot be staged
with an older parsed root list. Both callers removed their manual base copies.

A separate local-types graph context follows relative runtime, type-only,
import-type and triple-slash source edges. It never resolves installed packages
or evaluates runtime reader assets. Local and runtime projections share captured
source bytes with promptly disposed parser leases. The paired dynamic-reader
control proves an erased type source bypasses runtime descriptor validation,
while a real runtime import retains the exact literal-reader refusal.

The real outcomes preload also imports sources owned by other original
projects. Its actual production `OUTCOME_ORACLE_PRELOADS` seeds runtime imports
through SourceFacts and the same `OracleFilesystem.projectFor` the emitter uses.
`projectInputOwner` supplies each owner's local Program sources. Configs and
inheritance are staged unchanged; local Program files enter as exact file data.
All original typed source, installed, dependency, host and discovery facts are
validated at source before and after placement. Installed files remain owned by
the sealed oracle image and are never copied.

| Original owner | Root population in the measured source |
|---|---|
| `tooling/conformance/tsconfig.json` | 5 explicit roots |
| `tooling/gate/reader-inputs/tsconfig.json` | 1 explicit root |
| `tooling/gate/git-arguments/tsconfig.json` | 1 explicit root |
| `tooling/differential/tsconfig.json` | Original `*.ts` include: 55 roots, 169 local Program modules |
| `tooling/differential/oracle-seal/tsconfig.json` | 1 explicit root |

The measured source union is 1,616 files and 7,596,766 bytes. Some are checking
inputs, including the oracle family's handler. The command's executable
`moduleFiles` must reach only the outcomes handler; the planted executable
extra-family edge fails that assertion. Runtime/compile-time private namespaces
contain only returned placement files and ancestors with exact source bytes;
the planted extra runtime file fails. TypeScript, programs, benchmarks and
outcomes retain their exact private population assertions. No ownership,
installation authority or lstat check was weakened.

## Observed staging and test cost

The completed new fixture has 1,649 files, 7,622,631 logical bytes and 12,656,640
allocated bytes. The earlier main fixture had 2,620 files, 24,107,235 logical
bytes and 31,404,032 allocated bytes. Its six-call staging median was
1,939.839 ms. The new V9 eight-call median was 3,735.018 ms, range
3,565.075–4,175.650 ms: that staging observation was slower despite fewer bytes.
These runs were not isolated performance measurements.

A later helper-only phase probe measured these medians across eight calls:

| Phase | Milliseconds |
|---|---:|
| Owner discovery | 809 |
| Of which Program construction | 776 |
| Copier | 644 |
| Source observation replay | 73 |
| Complete helper | 1,527 |

These phases measure `copyFixtureProject`, not the entire fixture; medians are
not additive. The coordinator chose no memo: a keyed inventory cache and its
invalidation surface were not justified by about six seconds of repeated
Program work. Every staging still derives and validates fresh input facts.

The sequential per-file cohort uses main #797 before and the rebased refactor
after. All twelve commands pass. Outcomes has seven after leaves versus five
before, so these are validation-cost observations, not matched-work speed proof.

| Test file | Before wall s | After wall s | Before CPU s | After CPU s |
|---|---:|---:|---:|---:|
| `tooling/records/record-pending.test.ts` | 1.22 | 1.00 | 1.49 | 1.18 |
| `tooling/bench/run-recording.test.ts` | 0.16 | 0.10 | 0.19 | 0.12 |
| `tooling/bench/run-outcomes.test.ts` | 0.14 | 0.09 | 0.16 | 0.10 |
| `tooling/gate/oracle-record-identities.test.ts` | 0.17 | 0.12 | 0.19 | 0.16 |
| `tooling/records/summary.test.ts` | 1.44 | 1.05 | 1.52 | 1.14 |
| `tooling/records/record-pending-outcomes.test.ts` | 60.84 | 56.40 | 75.95 | 78.17 |
| Total | 63.97 | 58.76 | 79.50 | 80.87 |

The separate copier-component measurement was 1,448 files / 11,262,766 bytes
for the old complete composition. The shared command/preparation component was
102 files / 1,134,693 bytes. Independent family components ranged from 108 to
1,395 files (the outcomes component includes 1,216 declared refusal files),
with the selector's committed record dominating its 7,902,471 bytes. The common
102 files dominate most small family file counts. The roughly 350 ms component
walls do not describe actual per-test staging: most recorder tests construct
small data repositories. No net saving is inferred from that component table.

## Validation and selector

The final affected source passed strict, host and timing checks, SourceFacts,
81 copier controls, both compiled-axis arms and all seven live outcomes leaves.
The real pending outcome records an agreeing row; command handoff, cold gate
fallback and both planted-input controls retain their assertions. The helper
joined, temporary was removed after green and the unit drained.

The inner at `b743936981c7aff43c18745344a0b6a3b5608407` passed formatting,
Clippy, build and tests (3 / 1 / 1 / 745 seconds). It stays bound to that source.
After the #797 rebase, all 31 own non-document source blobs match the proved
pre-rebase tip; only independent workflow Decisions conflicted and both remain.
Every later changed path is absent from all 338 retained native dep-info files.
No Rust/native input changed, and the compiler SHA remains
`bd1b3c5b6446e447ad295d839dea9e170a67a9a181bd0d757bd43d8759c4e65e`.
The code and dep-info equivalence receipts are retained separately.

The tool-written selector refresh keeps all 57 targets and every role payload
identical. Only module-closure.ts/source-facts.ts engine and file facts, one
existing grouped file-fact digest and the key hash change. The record size is
unchanged at 5,397,261 bytes. The comparison decodes both records through the
production decoder and retains full before/after records and the exact diff.

Range selection still passes the base installation catalog to the tip. This
candidate changes module-closure.ts, a catalog input, so the known transport
defect reports `catalog-stale-live` and selects the conservative full route.
The standalone writer uses the candidate's own current catalog. No narrowing,
ALWAYS retirement or catalog-policy relaxation is claimed here.

Supported `--here` at `4b52d4e6778947f18ee265303d37724c41b220df` passed
all 19 selected checks plus the separate compiler build. Native passed 3,078
cases, failed none and retained eight ignored cases across 57 binaries and
19 doctest crates. The frontend checked seven files with zero failures or
unavailable executions. Tooling passed 2,738, failed none and retained the two
existing TODOs. The run was canonical with no experiments or interruption;
scope cleanup and diagnostics were complete and the temporary was removed
after green. The owning unit was inactive/dead-success and the tree clean.

| Supported observation | Wall seconds |
|---|---:|
| Runner | 652.437 |
| Native/frontend step | 285.772 |
| Tooling, including live projection | 360.168 |
| Records check | 236.076 |
| Gate-inputs live derivation | 212.628 |

The outside full-check benchmark session overlapped this validation. The
complete CLI reported green in 657 seconds; these are validation walls with
conservative selection, not a performance claim or an ALWAYS decision.


## Retained exclusions and follow-ups

Initial focused V1 stopped at strict before controls. Live outcomes V1 retained
an obsolete private grant; V2 lacked project/entry inputs; V3 chose overly broad
project options; V4 retained an obsolete empty-runtime proxy; V5 exposed local
type-source omissions; V6 stopped on an invalidated source catalog; V7 exposed
original-owner absence; V8 stopped at the FileInput/entry strict mismatch. V9
and the subsequent rebased cohort are the complete green proofs. Owner measure
V1 incorrectly treated data files as runtime owner candidates and refused a
generated .js path; V2 uses the actual preload's runtime import queue.
Cost V1 completed the before tests then its launcher hit unrefed-helper join
instrument 13; V2 uses the normal command lifetime and fully drains both arms.
No incomplete run supplies a positive verdict.

The scoped manual-copy search found seven production-base asset copies in
`conformance/node-preloads.test.ts` at lines 136, 225, 307, 336, 353, 384 and 420.
They remain later helper-migration candidates. Tooling-types intentionally
rewrites its diagnostic config; workspace/benchmark controls construct synthetic
projects. They are not unchanged-project migrations and remain untouched.

## Finite evidence

Proof source: `4b52d4e6778947f18ee265303d37724c41b220df`, based on
`d8cb99a440d27c4882f434900b07a20bf8f2440e`. The subsequent committed change
is this Markdown record only.

The raw manifest is `/home/akisarou/.cache/nts-scratch/803/raw-evidence-v1.json`, SHA-256
`f26182e4480a5027d84bf5ad5b1ecc061618f5a53322db0cd646b725876f8e02`. It binds 377 selected artifacts,
23,445,995 bytes and 350 immutable Git receipts, including
explicit absence facts. Its verifier independently rereads artifacts and Git
blobs and reports zero errors. Raw output remains in issue scratch and the
supported run `/home/akisarou/.cache/nts-landing/runs/here-4b52d4e67789-1794804466426`; it is not copied into documentation.

The earlier main staging observation is retained at `/home/akisarou/.cache/nts-scratch/719/staging-main-v1.jsonl`, SHA-256
`6395f8967b07d0b3bf861e1846ae0cfcac2b440741c3883e54ae90903725ebff`. The complete current comparisons, phase probe, original-owner
inventory, production-decoded selector diff, native equivalence, retained
failed attempts, source scripts and terminal/cleanup receipts are all selected
by the manifest. Exact-tip readiness and finite peer authentication bind the
record tip separately; no unchanged whole proof is requested for the Markdown.

