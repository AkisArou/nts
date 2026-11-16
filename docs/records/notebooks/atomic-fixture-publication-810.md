# Atomic publication of cross-process fixture records (#810)

The unchanged adversarial control fails against main's direct writer at “the final departure record is absent while its payload is incomplete”, and passes with atomic publication. The normal and cancelled runner arms keep their existing consumers: wait for the final path, then parse the record once.

The real root-fix landing `5bcf84b5a680-757acfaa` had already refused at `departure.test.ts:66` with an empty-JSON parse. Its original receipt and logs remain in `~/.cache/nts-scratch/719/root-queue-refusal-v2`; the source fix is established by the deterministic publication control, rather than by expecting that race to recur.

`departure.test.ts` publishes both `ready.json` and `signal.json` through the existing synchronous `durableRecord` owner. The fixture explicitly stages that owner. One `generatedJavaScript`-branded fence source serves the real runner arms and the adversarial child; the existing readiness audit therefore sees the injected producer as well.

| Control | Main fence | Fixed fence |
| --- | --- | --- |
| Payload paused after open, before its first byte | Final record already exists; named assertion fails | Final absent; one private empty stage |
| One-byte release | Not reached after the named refusal | Complete JSON parsed once; no pending stage |
| Cancel signal record | Not reached after the named refusal | Same atomic publication predicate |
| Teardown diagnostic, ms | 44.631839 | 0.071045 |

The teardown times are diagnostics from the owned clock, with no timing assertion or performance claim. The fixture joins stdin EOF delivery before the synchronous stop of its own unit, then joins the child's close; otherwise the stop call blocks the event loop while the child remains in its deliberate blocking read.

The paired audit control refuses a branded replacement fragment with a plain JSON writer and accepts the fragment using `durableRecord`. No audit recognizer or parse retry was added.

## Cross-process publication inventory

The source inventory reviewed 241 loose writer candidates, 103 candidate cross-process existence/read files and 115 syntactic poll sites. These are search populations, not counts of defects. `publication-inventory-v1.json` binds each disposition to exact Git source bytes.

| Fixture | Payload | Disposition |
| --- | --- | --- |
| scopes/departure | ready, signal | Fixed in this slice |
| census/census-scratch | ready path | Already durableRecord |
| census/worker-memory | slice readiness | Already durableRecord |
| scopes/stop | escape-ready, seal | Already durableRecord |
| scopes/nested-scope | workerReady, metadata, ready | Already durableRecord |
| scopes/run-owner | root info | Already durableRecord; leader joined |
| gate/tooling-runner | service and census readiness | Already durableRecord |
| gate/tooling-slice, tooling-slice-fixture | created slice, scope receipt | Already durableRecord |
| full-check/measure | active measurement | Already durableRecord |
| landing/run-holds | copied entry | Copy completes before separate readiness marker |
| gate/active-command | helper PIDs | IPC readiness follows completed writes |
| full-check/service | closed marker | Read after child close |
| gate/tooling-activity | clock receipt | Read after joined synchronous child |

Existence-only markers, intentional partial streams and sabotage inputs retain their existing semantics. No new publication wrapper was needed.

## Proof state

Focused V4 at `583528bed412980578e9194afdaf8f0dbf126b31`, using the exact fence literal from main `5bcf84b5a68092675d8725b08ad5499e6e394007` through a private read-only loader: actual main fence 1 with the exact named assertion, fixed 12/12; strict, timing and host audits 0. Resolver joined, green temporary removed, outer 0/null.

Inner at the same source is green: formatting 4 s, Clippy 46 s, compiler build 92 s, tests 459 s. These include cold-tree work and ordinary admission, and state no speed claim.

The accepted `rust-runtime.json` is inherited unchanged. This slice carries no selector-only refresh; #798 remains the owner of the next refresh. A stale accepted record keeps conservative live derivation, while an edited stale candidate remains refused.

Supported V2 at the same source is green: all 17 final PASS rows, including build, native 3,078/0/8 ignored, seven frontend files with no failures, and tooling 2,807/0 with the two existing Unicode TODOs. The canonical environment records no experiments and dirty source count 0. The first gate attempt had one memory-pressure INSTRUMENT: live gate-inputs derivation reached its learned 2.3 GiB boundary. Its other completed results were retained; the ordinary isolated attempt-2 passed gate-inputs without policy, cap or history edits. Both attempts certify complete scope cleanup and diagnostics. The first temporary remains registered after red with its oracle image dropped; attempt-2's green temporary was removed. The external command exited 0/null and its unit drained.

The landing owner reports 1,077.247 s, including the ordinary retry. The command took 1384.381 s including selection. These are observed costs under concurrent machine use, with no speed claim.

Raw finite evidence: `~/.cache/nts-scratch/810/raw-evidence-v1.json`, SHA-256 `d38685cacd4d73cfe96e5bc384e4d13b3a3bdc4bd706c581feaaff0869d42dca`. It binds 185 artifacts / 9,437,878 bytes and 42 exact Git facts, including absent new paths. It includes the original root refusal, unchanged-main counterfactual, fixed controls, audits, inner, complete supported attempts and external status. The final tip adds only this Markdown record. Exact-tip readiness and finite peer authentication are separate receipts in the same kept scratch.

## Excluded attempts

Focused V1/V2 stopped in private TypeScript syntax preflight before controls. V3 was interrupted at its own teardown before a completed counterfactual verdict. The committed EOF/close correction precedes the complete V4 results above.

Private full-tooling V1 was a launcher setup error: the sealed launcher lacked the gate's compiler, planner and checker handoff, producing missing release-binary and uncarried-checker errors. Its 2,771 passes, 26 failures and two existing TODO are retained as actual output, not a source verdict. The resolver joined and its red temporary was retained. It was not repaired or repeated: supported owns the complete tooling suite and its canonical environment.

Supported V1 was held before build because the disk owner needed 164,765,696 more bytes above its unchanged floor and active promises. All other steps were not run. After its unit drained, the owned test-profile incremental output was removed as prescribed by AGENTS (3,125,237,835 bytes). Approved pool upkeep reset the landed root tree and its disk owner removed only an obsolete profile; no retained evidence was deleted. Supported V2 uses the direct command and does not repeat V1's green dry-run.
