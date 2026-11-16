# Run-owned oracle image retention (#797, part 1)

The implemented scope is the run's own drained close. A newly created image
has an immutable acquisition receipt under its enclosing temporary. The receipt
binds the actual temporary, the image and its parent directory identities.
Exclusive creation prevents adoption of an older image. Borrowed parent images
and ready-image hits acquire no new receipt. Failed close removes only a
registered tree, retaining ready.json, semantic.json, ledgers and other evidence;
its report and retention row name the path and allocated bytes removed.
An image guard failure records that image as kept, without blocking valid
siblings or omitting the temporary from closed-failure accounting. A null
per-image byte count means it was not measured for disposal; the whole retained
temporary is still measured and registered.

A registered closed temporary is one completed lifetime. Reopening it through
NTS_GATE_RUN_DIR used to let preparation consume its old ready image while the
root remained eligible for pruning. Fresh acquisition now refuses that root by
name and asks for a new directory. Automatic queue retries, re-measurements and
bisect probes already allocate new runs; imported landing evidence contains
verdicts, contracts and binary observations rather than an installed image.
Live inherited handoffs and retries before close remain within one lifetime.

The existing size- and disk-pressure prune may evict a closed failed temporary
without a process-user check. That is a pre-existing limitation of whole-root
retention, unchanged by this image-disposal change; the new image guard does
not claim to repair it.

## Proposed interrupted recovery: not implemented

Dead-owner recovery is a new automatic deletion kind awaiting the user's
approval. No discovery, dead-owner classification or recovery is implemented
by part 1. Existing images and issue scratch remain outside its adoption scope.

A future recovery owner would require a versioned liveness registration before
installation writes, in addition to the immutable image acquisition facts. It
would bind a process PID and birth identity and the run's owned execution scope
by its kernel identity. The current version-1 image receipt alone would never
supply recovery authority. Parent-image borrowers would retain that lifetime
until their own work and helper completion had drained.

Recovery would require the original owner to have ended, its exact scope to be
empty or gone, and a complete live-process observation to find no image holder.
A shared controller scope, unavailable observation, reused PID, changed scope
identity, live borrower or unknown state would keep the image by name. An
exclusive cleanup claim would prevent new handoffs during the decision. The
owner would recheck the run, all ancestors and image identities immediately
before removal, using the same owned remover as explicit close.

The only removable object would be the explicitly registered image tree.
Ready and semantic records, call ledgers, logs, source trees, corpora and
unregistered images would remain. This would extend the existing run-temporary
owner; it would not infer ownership from folder names or scan historical caches
for images to adopt. Approval and a concrete liveness proof are prerequisites
for implementing that recovery path.

## Validation and retained failures

The fresh inner at `161205efe86cdb08e3adfcab390ba522d29c8c26` passed
formatting, Clippy, build and 808 tests, with no failures or ignored cases. Its
test phase took 740 seconds while the full check was active; this is a loaded
validation result, not a measurement of this change's cost. None of the seven
paths changed after it occurs in the 276 actual native dep-info files.

Focused V2 passed all new image and closed-lifetime controls but failed one
full-packet legacy environment expectation. V3 corrected that expectation and
passed the 32 canonical controls, preserving exact environment equality.
Full tooling V1 then had 2,709 passes, three failures and two existing TODOs.
The failures were kept and fixed at their owners:

- The image control measured delayed allocation before flushing its 16 MiB
  payload. Flushing it retains exact byte equality rather than adding a tolerance.
- The changed-producer control reopened its already closed negative run for
  the positive arm. Separate run directories preserve both assertions and the
  one-run-lifetime rule.
- Private Git commits could start detached automatic maintenance, racing
  scratch cleanup at `maintenance.lock`. The common test environment now owns
  `maintenance.auto=false` and `gc.auto=0`, including generated handoffs.
  The 24-commit control poisons local settings, checks the effective values,
  Trace2 child events, absence of lock/PID files and complete process-user
  observations. No directory or live-user guard was relaxed.

The affected V4 cohort passed 58 controls with strict and both audits green,
helper joined and temporary removed. Its copied outer launcher retained an
obsolete source label; that label is excluded as identity evidence. The child
asserts and records the exact `4049a9c4532d` source before and after every
command, and the original launcher plus the diagnostic are retained.

The final allocation control retained 36,864 bytes after dropping its exact
16,793,600-byte image from a 16,826,368-byte temporary. It independently checked
that ready and semantic identities and ledger bytes and modes were unchanged.
The deliberately red full-tooling run also exercised production close: its
own 145,313,792-byte image was dropped while the closed temporary remained
registered, with scope cleanup complete.

The writer changed only `results/gate-inputs/rust-runtime.json`. The first
refresh added `tooling/landing/tree-users.ts` through the image owner's new
process-user guard to 46 targets' file roles, with no file-role removals; the
target count remains 57. The second refresh changes only source-key facts.
It also captures the 2,400-byte oracle-count input for
`benchmarks/cases/jetstream-lazy-collections` from `fded76fbd420`, with SHA-256
`a6ba7d3c7bab9b32472ee64402700f724575cbd34bd16a51f3f198fa4cfa92c9`,
repairing the previously stale selector input as part of this submission.

The repeated full-tooling run passed 2,713 tests, failed none and kept the two
existing TODOs. Its independent live selector derivation passed. The step took
337.048 seconds; the complete owned run took 449.816 seconds including setup.
Canonical=true, experiments=[], scope cleanup and diagnostics were complete,
and the temporary was removed after green.

Range selection still has an existing endpoint transport defect: it passes
the base installation catalog to the tip. A changed installation-recipe module
therefore causes a conservative `catalog-stale-live` fallback for this candidate.
The writer prepares its own committed source and catalog, and the persisted key
contains portable source/SDK/content facts, not a catalog path, tree or digest.
The coordinator assigned the endpoint correction to the following #761 slice;
no narrowing or catalog check was weakened in this change.

Supported V1 was stopped only through its owning named unit after an
existing-main admission stalemate: a higher non-fitting growth blocked the
full check's fitting growth, and both retained their existing reservations.
It is interrupted instrument evidence with no supported verdict. The complete
pre-stop ledger and both diagnostic streams, the named-stop result and the
supplied-state replay are retained under `scratch797/stalemate-v1`. The exact
idle-release deficit remains 708,160,960 bytes. The replay's restricted backfill
model is diagnosis, not a fairness proof or a production change; #804 owns the
approved running-cohort correction. No bound was changed for the re-proof.

Supported V2 reran the unchanged source in a fresh run lifetime after admission
had room. All 18 selected gate steps and the separate compiler build passed.
Its native phase passed 3,078 tests with zero failures and eight ignored cases;
the frontend checked seven files with zero failures or unavailable executions.
Tooling passed 2,713 tests, failed none and retained the two existing TODOs.
The run was canonical with no experiments, no interruption or over-budget
memory observations, complete scope cleanup and diagnostics, and the temporary
removed after green. Its unit was inactive/dead with a successful result.
The full check's benchmark session overlapped this run; these walls are
validation evidence, not an isolated performance measurement.

| Validation | Outcome | Wall seconds |
| --- | --- | ---: |
| Fresh inner test phase | 808 passed, no failures or ignored cases | 740 |
| Repeated full tooling step | 2,713 passed, zero failed, two TODOs | 337.048 |
| Supported V2 runner | 18 PASS, separate build passed | 643.996 |
| Supported V2 tooling step | 2,713 passed, zero failed, two TODOs | 348.478 |

## Finite evidence

Proof source: `33272d0d5fe3d18808c2a387d03670217c89c0e8`, based on
`fded76fbd420c5ade20f54450dc53808431b8585`. The final record is the only
change after that proof. Raw output remains under
`/home/akisarou/.cache/nts-scratch/797` and the supported run
`/home/akisarou/.cache/nts-landing/runs/here-33272d0d5fe3-1794801076755`.

The authenticated manifest is
`/home/akisarou/.cache/nts-scratch/797/raw-evidence-v1.json`, SHA-256
`975de82c37c334c3d6fc0d03b3054033187df845af73ef462d70553057de2332`.
It binds 281 selected artifacts, 17,328,631 bytes and 112 Git source receipts.
`verify-evidence-v1.py` independently rereads those paths and immutable Git
blobs. Initial focused V1 stopped at strict checking before controls; its
negative output is retained along with the later expectation and fixture
failures. No green is inferred from an incomplete or interrupted run.

The final supported summary and its external terminal receipt are individually
bound below. Readiness and peer authentication bind the subsequent record tip;
no further whole proof is requested for that Markdown-only change.


- `/home/akisarou/.cache/nts-landing/runs/here-33272d0d5fe3-1794801076755/summary.json`, SHA-256 `f62a0bec8318cca0dc386ddf8341708de68de85e62bce39595155c4f1d648a5e`.

- `/home/akisarou/.cache/nts-scratch/797/supported-v2/terminal.json`, SHA-256 `f00467d91e4bcf6e67b04a09eef77b0cd35f97468be3af47ec7b28efe9641f22`.
