# Tooling load exposes an admission-clock ordering race

The [#669 on-demand tool](https://github.com/AkisArou/nts/issues/669), `node tooling/gate/tooling-load.ts --out <fresh kept-scratch directory>`, pins clean source, prepares a fresh compiler and the emitted CLI integration artifact, and runs the complete Node tooling inventory followed by that Rust harness. It is not a gate step. Each invocation owns one measured ledger reservation and retains the existing Cargo configuration guard through worker drain.

One fresh owner-bound experiment slice holds both readiness-signalled load and collector workers under an actual 800% CPU quota. All 24 load workers advanced after readiness. Node reported file concurrency 7 under that quota; this is not an uncapped landing-concurrency claim. Affinity excludes CPUs 4–5 and core dumps are disabled. Independently created fixture units remain outside the shared quota and are separately named in the retained output. Source, emitted artifact bytes, collector ancestry and CPU-control identity are checked.

Three discovery rounds at aca68e4f10cd0ad27b71a83f585dee79df2dbc10 completed all 282 Node files and all 164 Rust CLI tests. Two were green. The third found a real ordering defect and remains RED evidence. The two Node TODOs are the existing frontend-identifier and JVM-case Unicode findings. Every round drained workers, scopes and admission completely, with no instrument packet or resource-observation failure. Admission was released between rounds.

| Discovery round | Node pass / fail / TODO | Rust CLI pass / fail | Quota-group wall s | Quota-group CPU s | Throttled / total periods |
| --- | --- | --- | --- | --- | --- |
| 1 | 2437 / 0 / 2 | 164 / 0 | 1712.880 | 13705.037 | 17125 / 17129 |
| 2 | 2437 / 0 / 2 | 164 / 0 | 1724.378 | 13799.473 | 17241 / 17244 |
| 3 | 2436 / 1 / 2 | 164 / 0 | 1932.858 | 15465.157 | 19326 / 19328 |

The quota-group CPU includes synthetic load and both test phases; aggregate throttling is not elapsed wall. These are contention and discovery observations, not performance comparisons or three green rounds of the corrected owner. Full one-second load, memory, resident-charge, memory-event, CPU and PSI samples remain in kept scratch.

Round 3 failed `a census holding a case still reaches its bound` at `tooling/gate/step-bound-admission.test.ts:160`: after the supplied clock advanced to 4000, `expired` was false instead of true. This was an assertion failure, not a real-time hang-guard expiry. The coordinator recorded the full check starting its wide run on e38247209ae509ed4e79ca02c7d1bfd75b524a56 at 2026-11-15T11:39:50Z, with three censuses and fourteen other steps. That outside load overlaps the failed control.

The conservative complete-file resource window was 2026-11-15T11:41:23.680Z to 2026-11-15T11:45:22.594Z. It bounds collector start using request creation and the first observed Node completion minus measured collector duration, with one-second margins; it is not an exact per-test timestamp. The window had load1 37.57–72.29, available memory 9.91–15.35 GiB, CPU PSI some avg10 64.63–68.83 and full 51.86–59.04. Memory PSI some avg10 and experiment-root own-OOM delta were zero. Every quota sample remained 800%. Exact output, window method and raw readings are retained.

The token broker updated its held counters, sent `go`, then published `pool.change`, where the runner observes its step execution clock. A synchronous client could run before that observation. Running time was then charged as excluded memory admission wait, so the step execution bound could miss it. This is production accounting, not only a test assumption. The correction publishes the held transition before either answering path. The separate per-command CPU supervisor and all bound values are unchanged.

| Supplied socket/clock interleaving | Execution s | Excluded memory-wait s | Expired |
| --- | --- | --- | --- |
| Old unsized grant | 0 | 4 | false |
| Old synchronous sized grant | 0 | 4 | false |
| Old asynchronous sized positive control | 4 | 0 | true |
| Corrected owner, all three grant paths | 4 | 0 | true |

This component control uses the real token-pool and StepBoundClock owners, with supplied socket delivery advancing the client clock before the producer resumes. It is not a kernel timing measurement. The same unchanged script produced old and corrected receipts. Permanent controls cover all three grant paths. The original real census control remains byte-exact, with no added wait or weaker assertion. All four original census-clock cases passed after the correction.

| Correction and final checks | Actual result |
| --- | --- |
| Worker/CPU, token/lease and bound consumers at dc48c263f5bb | 39/39; no skips, cancellations or TODOs |
| Placement and worker/CPU repeat at 1c0f373210e3 | 7/7; no skips, cancellations or TODOs |
| Timing, host and strict audits | Green |
| Required inner route at dc48c263f5bb | Status 0; formatting, Clippy, fresh compiler and crate/backend tests passed |
| Supported landing route | 19 summary steps PASS; canonical, no experiments; cleanup and diagnostics complete |

The inner source differs from the final proof only in the exact driver placement, its selector control and the explicit worker environment parameter. All Rust, Cargo, inner and token-bound inputs are byte-exact. The final supported route exercises the complete final source.

Focused V1 stopped at seven new strict diagnostics before tests. Focused V2 stopped at the two inline-worker host-audit refusals before tests. Their logs and source pins are retained; the owned URL fixture and focused V3 passed without relaxing either audit. The initial summary verifier refused its stale all-green terminal assertion for round 3; corrected V3 preserves the actual RED and published no earlier acceptance summary. The first supported route passed every row except gate-inputs, which refused the newly unplaced standalone driver. Its exact-path rule now owes tooling plus a named-unit manual full round; an unknown neighbouring driver still owes the full gate. Focused V5 then refused two environment aliases when the new path control brought the driver into host-audit reach. Its worker now receives the same environment explicitly from the command entry, retaining its sealed assertion, without an audit allowance; V6 passed all seven controls and audits.

Raw evidence: /home/akisarou/.cache/nts-scratch/669/raw-evidence-v1.json, SHA-256 ded9a370abe5034093cb4e9c620f3e703a0992a811eff3cf527f937d2252bc2b. The finite manifest binds selected logs, outcomes, resource samples, launchers and immutable Git source receipts, including the discovery RED and old/current interleaving. Regenerable build and temporary trees are outside its artifact set. Proof source: 1c0f373210e3a6264fbd9c7b831c79cee3260031.
