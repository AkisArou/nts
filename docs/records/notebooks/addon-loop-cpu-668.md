# Addon loop uses the shared CPU and activity supervisor

The [#668 addon control](https://github.com/AkisArou/nts/issues/668) sends its single loop command through the existing case-bound.ts owner with the default CPU and inactivity policy. Each call owns a private instrument packet through child drain. The exact host-loop checksum, deliberate interposition failure and native-crash distinction remain product assertions. The supervisor implementation and its policy are unchanged.

The blocked-driver control uses the same route with a private one-second inactivity guard. Its ready marker precedes the block; the actual result is status 124 and a packet naming its private step and attempt, kind hung and verdict NOT RUN. No elapsed-time assertion decides this control.

| Control | Actual result |
| --- | --- |
| Addon module native controls | 6 passed, 0 failed, including the blocked-driver and native-crash controls |
| Shared supervisor consumers | 8 passed, 0 failed |
| Diagnostic-only affected native repeat and timing/host/strict audits | Pass |
| 20 concurrent loaded native replays | 20 passed; exactly one case each; all 40 Node decisions retain expected status 0/1 with no signal or instrument packet |
| Supported landing route | 9 summary steps PASS; canonical with no experiments; cleanup and diagnostics complete |
| Required inner route | Status 0; formatting, Clippy, fresh compiler and crate/backend tests passed |

The standalone load experiment was one ledger-admitted unit, with 24 busy worker threads and 20 native replays, all outside CPUs 4–5. Its explicitly approved quota was 800%, verified from cpu.max as 800000 100000. This quota is an experiment condition. Every worker reported ready before the replays began, and all workers drained afterward.

| Loaded cohort quantity | Observed |
| --- | --- |
| Whole replay wall | 30.689–33.803 s |
| Whole replay process-tree CPU (GNU time user + system) | 5.86–6.20 s |
| Cgroup throttled periods | 340 |
| Aggregate cgroup throttled microseconds | 735853414 |

The load cohort source e5ee153333b739abcb15cb487229d778b423db3f differs from final proof only by replacing the blocked control's one-element clone with std::slice::from_ref. The affected blocked control and Clippy passed again. Supported V1's Clippy failure is retained as excluded evidence; inner was unrun there.

The wall and CPU ranges include addon compilation and both Node calls inside each Rust test. They demonstrate loaded replay survival with no supervisor policy firing. They do not reproduce or predict a timeout from either the original per-Node 30-second bound or main's later 300-second guard. Aggregate throttling is not elapsed wall time. Per-replay logs, CPU and supervisor decisions, plus complete cgroup/load samples, are retained in the manifest.

An initial broad formatting invocation touched vendored files; they were restored before committing and proving this change. Later formatting used the gate-scoped route. That setup error supports no acceptance claim.

Raw evidence: /home/akisarou/.cache/nts-scratch/668/raw-evidence-v1.json, SHA-256 2806d4c8de76de6c6d26fa4683a660aea6b23dd435588ae1a876fdf374713c9d. The finite manifest binds selected control, load, supported and inner artifacts plus immutable Git source receipts. Proof source: 45e8bb30642e6db0ee3e2d2f620f0a44615d5e16.
