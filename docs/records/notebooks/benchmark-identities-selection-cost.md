# Benchmark identity selection cost

2026-11-17, issue #546. The question was how much the compiled-program benchmark
member declaration adds to selection, before choosing a performance repair.
Main was `39f4978a723067b4f99b6639aa8967551a4827bc`; the revision was
`67bb55a9389d08354141edb019d13de537a9390e`.

`withSelectorSources` prepared the two committed trees through the ordinary
linker. One named unit ran `with-lock.sh --wait --key perf-count`, with each
sample and its descendants on CPU 4. Each scope used main/revision/main order.
`perf stat` counted user instructions across the command and its descendants,
including the SDK process. Provisioning was outside the sample. These are
selection-work counts, distinct from benchmark workloads or Node oracle counts.

The selector sample called production `owed` and `gateSteps` for the existing
path `compiler/core/src/lib.rs`. It passed main's catalog to both endpoints,
as range selection does. Main rebuilt its stale Rust projection; the revision's
changed catalog pin conservatively owed all Rust targets. The census used each
tree's own ordinary catalog and the production census operations over all
tracked paths. Its probe additionally extracted `inputMetadataDeclarations`
unconditionally; these census rows therefore include that diagnostic cost.
The landing CLI extracts that metadata only when unavailable inputs exist.

| Scope | Arm | User instructions | Wall seconds | Task-clock seconds |
| --- | --- | ---: | ---: | ---: |
| selector | main, first | 1,530,172,020,889 | 149.310 | 146.848 |
| selector | revision | 3,134,864,221,816 | 342.551 | 290.138 |
| selector | main, repeat | 1,540,264,956,524 | 132.618 | 131.816 |
| census plus metadata | main, first | 1,634,143,145,316 | 147.679 | 147.226 |
| census plus metadata | revision | 4,210,969,326,814 | 417.973 | 364.579 |
| census plus metadata | main, repeat | 1,637,861,100,948 | 140.474 | 139.367 |

The two main instruction counts differ by 0.66% for selection and 0.23% for the
census probe. Relative to the mean of its two main controls, the revision uses
2.042 times the selection instructions and 2.574 times the census-probe
instructions. All samples completed successfully. Each census reported 28,852
tracked paths, 88 full-gate paths and zero placement problems; directory
declarations were 605 on main and 610 on the revision.

The complete raw output is
`~/.cache/nts-scratch/546/review-cost.log`, SHA-256
`2907de401ae547daf38682d05eeb7812af63a9cd1b729f30dc4b2fd309acd924`.
The six perf files and probe source versions are cited individually in
`~/.cache/nts-scratch/546/review-cost.sha256.json`, SHA-256
`4f40047b517e00737642fe16ef30c980dbcf235c866850ca588ec7e2ced52157`.
The selector worker and the subsequent census worker have separate retained
source versions; the census worker supplies each tree's own catalog.

Read-only source hooks, SDK request timing and CPU profiling then attributed
cost under admission on CPUs 16–31. This attribution run is separate from the
controlled comparison. Its full selector walk made 2,293 project reads and
2,338 Programs, including project references. Project reads occupied 338.939
of 445.077 wall seconds; Program creation occupied 202.357 seconds within those
reads. Repeated catalog authentication occupied 22.255 seconds within the reads;
reader identity capture occupied 40.133 seconds across the whole walk. Program creation and catalog
authentication are included in project-read time.

An isolated benchmark-member walk made 165 Programs. With a current catalog it
took 24.623 seconds, with 16.191 seconds in project reads, including 8.535 seconds
creating Programs. Without a catalog it took 23.565 seconds. The selector's
repeated `modules.describe` calls reconstruct identical project requests in
separate walks; the Rust adapter already uses the graph's explicit validated
batch owner.

At recording, a design to extend that explicit batch lifetime across selector
discovery awaited coordinator approval. The measured regression remains an open
review item. Final comparisons can use the landing CLI's conditional census
sequence after a repair.

The profiling log, hooks, metrics and CPU profiles are retained in
`~/.cache/nts-scratch/546/review-profile.sha256.json`, SHA-256
`0f030d77c7a33bee5efb520181a48ee4877bab59f4d5aa356c361b3191316943`.

## Instruction attribution and resolution controls

On 2026-11-18, a read-only hook and instruction-sampling run compared main
`39f4978a723067b4f99b6639aa8967551a4827bc` with
`6c300dd6ec24f45c06aa8499fee5371f9d7956f0`. The ordinary selector graph made
1,815 benchmark project reads for 165 distinct request/context pairs: eleven
passes over the cases. Their sampled instruction budget was:

| Benchmark project-read phase | Trillion user instructions |
| --- | ---: |
| Program construction | 1.83902 |
| Program inspection | 0.27472 |
| Catalog authentication | 0.10584 |
| Other project-read work | 0.12128 |
| Generated configs, including fsync | 0.02090 |
| Config parsing | 0.00552 |
| Program disposal | 0.00110 |
| Total project reads | 2.36838 |

Reader identity capture after those reads added 0.06852 trillion instructions.
The phases partition project-read work; their total is not an additional cost.
Perf totals were 1.518320 trillion on main and 3.142008 trillion on the revision,
with 99.8% and 99.9% sampled coverage. As in the original selector comparison,
main rebuilt its live Rust projection, while the revision's changed catalog pin
conservatively forced all Rust targets. The net increase of about 1.624 trillion
therefore includes benchmark work partly offset by about 0.812 trillion less
other work. This attribution is separate from the uninstrumented verdict
comparison.

A private two-case control ruled out combining the cases into one Program.
Case A imported `phantom`; case B supplied an ambient declaration for that
module. With the same options, A's independent Program reported TS2307, while
the union Program reported no diagnostic. The population also had two effective
option groups: 163 cases used the default options and two specified Node types.
Separate case Programs preserve both roots and ambient/config context.

A second control compared a fresh native module resolver with one native
resolver shared across separate Programs. The first Program imported a missing
`later.ts`; the file was created before the second Program. Both modes found
the new file, and both made the same observed callbacks:

| Resolver mode | State | fileExists | directoryExists | readFile |
| --- | --- | ---: | ---: | ---: |
| Fresh | missing | 20 | 10 | 1 |
| Shared | missing | 20 | 10 | 1 |
| Fresh | materialized | 11 | 9 | 2 |
| Shared | materialized | 11 | 9 | 2 |

The shared resolver showed no saving in this control. Neither a union Program
nor shared native resolver state was selected as the repair. The approved
design retained the existing complete discovery key and validators within one
synchronous `stepInputGraph` traversal, with its three description sites using
that scope. Its controlled performance result remained pending the #798 rebase.

Raw phase samples, counters, hooks, semantic controls and analysis are covered
by `~/.cache/nts-scratch/546/instruction-profile-v2.sha256.json`, SHA-256
`d5b64ac907a113a810f3615049df26cabdc066c65bb44ce3de83667bfbad5b3e`.
Its retained first pilot failed before selection because the scratch control
passed JSON strings instead of parsed SDK options; the successful version used
the SDK's parsed config options.

## Snapshot retention control

A later committed prototype at
`26add1a7aa96b7acb5bb2f822a1ab1445dde6fe6` added whole-snapshot copies and a
separate run-reader wrapper. The single mutated current-catalog LLVM self-test
exhausted Node's ordinary heap limit before reaching its selection assertion.
Its raw log is `~/.cache/nts-scratch/546/single-llvm-control.log`, SHA-256
`012a0fb04471a7dc2461170ae4d284c005891091b295e039c88353fc6e7872d1`.

Private read-only hooks then compared that prototype with removal of just the
copies, and with the approved scope-only behavior. All used the same committed
source and current catalog on CPUs 16–31. Forced GC at sampling boundaries
measured retained heap without enlarging the heap limit; these are diagnostic
controls, not ordinary-Node or landing timing proof.

| Arm | Project reads at Rust snapshot 20 | Observation rows there | Post-GC heap bytes there | Outcome |
| --- | ---: | ---: | ---: | --- |
| Prototype with copies | 333 | 555,829 | 3,903,965,520 | heap exhaustion |
| Only copies removed | 333 | 555,829 | 1,646,884,752 | expected named counterfactual failure |
| Scope only | 335 | 555,829 | 1,647,218,560 | same named counterfactual failure |

Removing only the copies reduced heap at the identical boundary by about
2.26 GB. The no-copy and scope-only arms completed with 604 and 606 real project
reads respectively and returned the same complete LLVM order failure text.
The broader wrapper therefore saved only two reads in this control. The
scope-only arm's maximum sampled post-GC heap was 2,606,220,032 bytes. The
approved repair excluded both the extra whole-snapshot copies and the broader
cross-graph wiring; normal heap settings, request-key isolation, scope closure, fixed-probe
reach equality and paired performance still required final proof after rebase.

The scripts, raw output, JSONL samples and summary are covered by
`~/.cache/nts-scratch/546/scope-memory-v2.sha256.json`, SHA-256
`731fac370434047937c61165810d39fc7ae7a86ac6441ddd5a9b712ea1adb2f0`.
The retained first harness attempt failed during imports on a null built-in
loader source; the successful version checked imports before running discovery.

## Ordinary owner boundary and phase controls

Review retained the project-read owner as the mechanism within the ordinary JS
graph only. Rust selector threading was outside the approved boundary. At
`6cfb77238165550134fd42a65c703570737d9020`, all nine owner controls passed under
ordinary Node settings, and strict tooling checked six projects and 1,155 modules
with no diagnostic increase. Config-only byte differences between otherwise
identical views selected different actual Program roots and required two reads.
The complete query key also distinguished entries and namespaces.

The body phase ended before inspecting its returned value. The control attempted
a cached request from a returned `then` getter and both cached and new requests
during end validation; all were refused. A private load hook restoring the old
phase ordering failed with the exact message, "Missing expected exception:
return-value inspection follows the body phase". Production source was unchanged
by that negative control. This proved the owner boundary, not the pending final
integration or paired performance result.

The eight-file proof manifest is
`~/.cache/nts-scratch/546/owner-317-proof-v2.sha256.json`, SHA-256
`eed7ea3ca86d00a0ab2360fc6adb50d2ea2d21d6b23ab4a543a1e8c9de5b7b07`.
This manifest binds an immutable copy of the then-approved owner design; the
test output and script hashes are unchanged from the original manifest.
The normal focused/strict log is `owner-317-controls-v2.log`, SHA-256
`8175af6df746a638b03b76e755e6438958ea70f03babb90bfe634c54ad039004`;
the expected negative-control log is `old-owner-phase-control.log`, SHA-256
`73d2ded98641485dc431e978badffca4008bf3dbec31e11af8df3dbdc66e6ceb`,
both under the same issue scratch directory.

## Ordinary-Node mutation branch

At `9ee77d1e2d5276ead6952bf0c4e0117684926cf4`, the added deep snapshot copies
were replaced with independent row lists referencing the existing facts. The
ordinary graph also forwarded the complete reader context to its owner. Fourteen
owner/batch controls passed, including a real fixture-entry integration control.
After ordinary offline input publication, the current-catalog LLVM control's
single mutated `selfTest` passed in 163.674 seconds: it required the named
missing-benches order failure and restored the rule in `finally`. Its redundant
baseline and restored self-test calls were absent. Strict tooling checked six
projects and 1,155 modules with no diagnostic increase.

This run used ordinary Node settings, with no private load hooks, forced GC or
heap enlargement. Its named admitted unit was `nts-546-327-mutation-proof`.
The raw output, including command lines and Node options, is
`~/.cache/nts-scratch/546/327-mutation-proof.log`, SHA-256
`e3f15b18ccc1ef3a9ee34543f6dbe37e1e58a56ad1faf38f368c3dd1dbe85518`.
This completed the mutation-branch proof; the post-#798 paired selector/census
comparison and fixed-probe reach equality remained pending.

## Replacement scope boundary

The coordinator's replacement decision selected the existing
`describeBatch` lifetime over the ordinary graph's three description sites. The
final repair retained the complete request/entry/namespace key and original
batch state only. The separate frozen-answer wrapper and extra snapshot
retention were outside that final boundary. Rust retained its independent batch.
With copies removed, the wrapper and scope-only controls had similar sampled
post-GC peaks (2,643,343,352 versus 2,606,220,032 bytes) and 604 versus 606 reads.
The deciding reason was one batching mechanism: the existing transaction
already owned the key, deduplication and validators.

The owner experiments above remained historical controls. Final acceptance
also required main's post-GC peak for the same mutated control and full
selection, measured with the scoped version's retained-heap protocol. An
absolute 2.6 GB peak alone was insufficient: substantially higher retention
than main required attribution. That diagnostic comparison was separate from
ordinary-Node tests and uninstrumented timing, with no larger heap. Unchanged
fixed-probe owed sets and paired selector/conditional-census cost within 1.10
times main remained required. The post-#798 rebase, measurements and final
scope implementation remained pending.

## Sole description-scope cleanup

At `a37257f6b347721b711c25ec922ab9b12555e22f`, the parallel
`selection-project-reads.ts` owner and its test were removed. The ordinary
step graph's three description sites used the existing `describeBatch`
transaction through `withDescriptions`. Rust retained its independent route.
The scope retained shallow row-list references to original facts, performed
its original validations before returning, and closed its request capability
immediately when the body returned, before inspecting a `then` getter.

The owner controls were ported onto that scope. Real Program membership
separated committed and working endpoints, including otherwise identical
views differing only in config bytes. Real generated ConfigDirs witnessed
request/entry/namespace separation and reuse of equivalent requests. Later
scopes observed missing inputs becoming present. Catalog-specific unavailable
inputs, visitor provenance, cleanup on failure, and rejection during validation
and after close remained covered. Clearing a returned observation list could
not hide a later config edit from the retained end fence.

| Proof | Result |
| --- | --- |
| Description-scope controls | 11/11 passed |
| Single mutated current-catalog LLVM self-test | passed; named missing-benches failure required; 159.902 seconds |
| Strict tooling types | 6 projects, 1,153 checked modules, no diagnostic increase, 0 pending projects |

The admitted named unit was `nts-546-369-scope-proof`, on CPUs 0–3 and 6–31,
with ordinary Node settings: no private hooks, forced GC or larger heap. Its
raw output is `~/.cache/nts-scratch/546/369-scope-proof.log`, SHA-256
`b9bd24e30d1a217aedaaf5dddca43270ecb2031f6520beb14bb82684a77d1bae`.
Its command wrapper is `~/.cache/nts-scratch/546/run-369-scope-proof.mjs`,
SHA-256 `aaa372d984f8b5698488a4311d6bea8dc8f3e29727d0ea561107ba3db134c33a`.
The tree remained clean after the run. This proved the cleanup at the existing
main; root/match reconciliation, paired performance, fixed-probe reach equality
and matched main/revision post-GC heap comparisons still awaited #798.

## Rebase over the pooled accepted-source self-test

The branch rebased without conflicts over main
`531d75a7e43c35907f596e090ed31067ceed835c` to
`21206aeab9c59dead6e7f4269fc6b71cd00ed994`. Main's
`acceptedSourceSelfTest()` export and shared CLI/pooled entry remained unchanged.
The `all.sh` delta contained only the identity step and its adjacent rationale;
it did not restore the removed standalone selector self-test command.

| Focused proof | Result |
| --- | --- |
| Benchmark recorder, description scope, project inputs, Rust runtime inputs/declarations, source facts and step table | 79/79 passed |
| Missing-catalog forced-set control | 1/1 passed |
| Single mutated current-catalog LLVM control | 1/1 passed; named failure required; 106.330 seconds |
| Identity step reader-reach control | 1/1 passed |
| Accepted-source self-test CLI | passed through the shared exported entry |
| Strict tooling types | 6 projects, 1,166 checked modules, no diagnostic increase, 0 pending projects |

The named admitted unit was `nts-546-610-focused`, using ordinary Node settings
on CPUs 0–3 and 6–31. Its raw output is
`~/.cache/nts-scratch/546/610-focused.log`, SHA-256
`8530747e7628f6f8cb3b026bc6d64be0d1f396dd1d5d5d567b612b00eb30e700`.
The wrapper is `~/.cache/nts-scratch/546/run-610-focused.mjs`, SHA-256
`71698fb0db30fb465bdbc926bd70b4e8e896082fe2f01c7357f23da0a677b30c`.
The tree was clean after the run. #798 had not landed: the coordinator retained
the hold on measurements, inner and `--here` until its project-reader changes
could be reconciled. No paired performance or final landing verdict was claimed
from this focused run.
