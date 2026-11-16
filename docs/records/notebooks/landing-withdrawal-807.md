# Withdrawal drains the running landing (#807)

The actual-main runner counterfactual starts a build after its withdrawal is
accepted and capacity returns. The fixed runner cancels that pending admission;
its timed build and running gate controls join their real children and scope
owners before publishing withdrawn. This is a correctness change, with no speed,
capacity, bound or recorded benchmark claim.

## Decision table

| Trigger | Required result |
|---|---|
| Queued entry withdrawn | Answer immediately; no check starts |
| Already requested before run | No build, candidate or ledger admission |
| Build admission pending, then capacity returns | Cancel request; compiler never starts |
| GNU time wrapper and live build payload | Captured group SIGTERM reaches payload; join before releasing hold |
| Running gate | Existing scope owner certifies root and samplers drain |
| Memory retry boundary | No replacement attempt after cancellation |
| Drain unproved | Named held status, run path, checking/tree/hold/request retained; next entry waits |
| Retained closer later closes | Same lifetime certifies and resumes |
| Failed certification, repeated withdraw | Same directory watch wakes a recheck; no new run |
| Service restart, persisted group gone | Read-only birth facts plus existing gate root owner certify before warm preparation |
| Incomplete durable publication | Ignore unpublished temporary and preserve its bytes |
| Watch setup fails | Service refuses before taking an entry |
| Watch breaks mid-check | Current verdict remains its own; next entry is not taken; status names restart |
| Marker arrives after broken watch | Locked final fence still prevents publication |
| Withdrawal wins publication lock | Main does not advance |
| Publication wins lock | Withdrawal reports too late |
| Compare-and-swap loses to moved main | Restore cancellable phase |
| Group acquisition boot read fails | Clean and join only the directly spawned child |

The watcher is one fs/path leaf with a type-only Queue dependency. Config carries
its source-owned factory; the production entry always binds the real factory,
with no flag or environment substitution. The existing process-group fence owns
all negative-group signals. Persisted birth observations grant absence checks
only, never signalling authority. All importers use those owners directly.

## Actual proof

Focused V5 at ac77927d115c: 103/103; strict, timing and host audits all zero.
The before arm substitutes only the exact main run.ts policy through a private
loader, with fixed dependencies unchanged; it fails the named assertion rather
than hanging. Helper source approval is separate from these actual results.
The final affected repeat at d5e8dea537e1 is 31/31 with strict, timing and host
all zero. It includes the real runner's future-version scope receipt refusal:
the terminal stays absent and the withdrawal request remains durable until the
original bytes are restored and repeated withdraw certifies both the empty root
and ledger. Concurrent watcher-fault and memory-held reasons stay visible in
either arrival order.

| Proof | Actual result |
|---|---|
| Exact main 422e0084 run.ts counterfactual | Named admission-cancellation assertion fails; capacity returns only after withdrawal is accepted |
| Focused V5, ac77927d115c | 103/103; all three audits zero |
| Final affected V6, d5e8dea537e1 | 31/31; all three audits zero; external terminal 0/null |
| Inner, ac77927d115c | Formatting 3 s, Clippy 1 s, build 1 s, tests 269 s; green |
| Supported, 97e704455288 | 19 summary PASS plus separate build; all 20 selected steps pass |
| Supported tooling | 2,804 pass, zero fail; two existing Unicode TODO |
| Supported completion | CLI 0/null; canonical, dirty 0, no experiments; scope cleanup and diagnostics complete; temporary removed after green |

Inner's 1,666 retained dep-info files contain none of the four later changed
paths: the final service and two test changes plus the writer's generated record.
All 1,632 Rust source blobs are byte-identical. The inner proof remains at its
actual source; it is not relabelled as a fresh run on the final tip.

The normal selector writer changes only results/gate-inputs/rust-runtime.json.
Its decoded projection keeps the exact 57 Cargo targets, adds process-group.ts
and its reader reach to 47 target owners, and removes no existing role. Engine
facts grow from 120 to 121 and key file facts from 10,057 to 10,058; existing
active-process.ts and queue.ts identities refresh. This is additive reach, not a
claim that every target role stayed equal. The projection inspection uses the
production decoder once per record.

Supported owner wall is 805.439 s (summary 800.807 s); the enclosing CLI takes
869.859 s. Tooling takes 442.917 s wall / 5,375.422 s cgroup CPU, gate-inputs
92 s and records 251 s rounded in the report. Ordinary full-check competition
was present; no before/after performance comparison is claimed. The memory
receipt records two job growths, two shrinks, one step growth and zero step
kills. There is no replacement attempt directory.

Exact-tip readiness is a separate seven-command metadata check, with strict
last. Its actual terminal and cleanup receipts are required before submission;
it creates no oracle session. Inner and supported own their ordinary sealed
images.

## Excluded runs and limits

V1 stopped at strict before controls; V2 stopped at the host audit before controls.
V3 was 98/102: additive status expectation, two late fixture cleanup hooks and
watch-fixture over-staging. V4 was 102/103, with only that over-staging remaining.
All are retained separately and excluded from the final green proof.

The GNU time routing probes separate direct/scope exec from wrapper forking:
SIGTERM to time's PID alone left its payload alive; the captured group control
requires payload cleanup. Signals never use a PID discovered through a process
search. Existing cleanup guards remain unchanged. A zombie is not a live group
member; another boot proves the previous boot's processes gone. On the same boot,
read-only certification checks PGID, session and member birth time together.

No existing corpus, benchmark row, compile producer key, memory policy or gate
parallelism cap changes. Kept unpublished files and failed run evidence are not
deleted by recovery. Raw machine evidence remains in issue-named scratch; final
manifest is
/home/akisarou/.cache/nts-scratch/807/raw-evidence-v1.json, SHA-256
872edcaa3499e8af8b48d9472dfeeae43a3f0b9a975f383113fcfda8941522a4.
It binds 2,011 artifacts / 27,458,373 bytes and 210 Git source receipts,
including explicit new-path absences. The independent byte/source verifier
reports zero errors. The supported run is
/home/akisarou/.cache/nts-landing/runs/here-97e704455288-1794831822196.
Proof revisions are retained under refs/cited/807-evidence-*.

The initial read-only projection inspection was interrupted after constructing
the decoder repeatedly. It produced no accepted result and changed no source;
the corrected named, admitted unit uses one decoder per record and completes.
The initial scope routing probe's unsupported property setup is also excluded.
The later routing probes, focused receipts and all failed fixture runs remain
separate in the raw manifest.
