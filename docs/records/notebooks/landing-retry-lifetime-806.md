# Landing retry lifetime (#806)

A landing joins its build reservation's sampler before starting another
attempt. Candidate commands run asynchronously in the landing owner, and
`landing.json` is published after the sampler drains. The existing 60 s
failed-drain guard is unchanged. The actual `--here` control completes a
held-then-green retry, prints the final PASS report and exits 0.

## Evidence

The proved final source is `14c9be89f293d04739c7d69b0890d6bcf189fd11`.
Raw evidence is kept at
`/home/akisarou/.cache/nts-scratch/806/raw-evidence-v1.json`, SHA-256
`07e5defce2afa3ab4fbc789b510ca575aaa0bb727da94e188ada5cfb554c3f8a`.
It authenticates 586 artifacts, 19,961,826 bytes and 140 Git source receipts,
including explicit absences. The independent verifier found zero errors.

| Check | Actual result | Boundary |
|---|---|---|
| Main counterfactual | One intended assertion failure | Actual main `run.ts` at `1d242528fdd1d3d861301661e14473105e259df7` starts attempt 2 before the supplied sampler close; the assertion reports 2 attempts instead of 1 |
| Fixed focused controls | 65 pass, 0 fail, no cancellations, skips or TODO | Includes real Worker delivery while a child remains pending, supplied retry ordering, actual `--here` reporting, and service retry/publication |
| Strict, timing and host audits | All exit 0 | No debt increase, audit exception or policy allowance |
| Inner | Formatting 3 s, Clippy 64 s, build 1 s, tests 308 s; all pass | 664 passing native tests across C, JVM and LLVM backend crates |
| Rebase onto landed #719 | Ten own code blobs byte-identical | Two documentation files merge only #719's independent text; none of the final 21 changed paths intersects any input in 383 retained actual Cargo dep-info files |
| Selector writer | Exit 0; all 57 targets and all target roles identical | Only three gate-source byte facts and their infrastructure aggregate change in the key |
| Supported `--here` | Build plus 19 gate steps PASS; external exit 0/null | Canonical environment, no experiments, complete scope cleanup and diagnostics; temporary removed after green |
| Full tooling within supported | 2,773 pass, 0 fail, 2 existing Unicode TODO | No cancellations or skips |

The focused controls and inner ran at
`2edb305e1109a43b0995211624f6dc4eade56a09`. The clean rebase onto #719 is
`ba3c24c99580b973d306a1d1cdf51a8e8b2445f6`; the writer's generated record is
the sole following change before the supported proof. Source equality and
retained Cargo dep-info bind that earlier native proof to the final source.

The selector projection SHA remains
`182547b0f62d4bded779d43aa8a794f4d8cab695dc3a444221d3f20619ed43d1`.
The key changes are the bytes of `memory-ledger.ts`, `memory-watch.ts` and
`worker-lifecycle.ts`, plus the gate directory's infrastructure aggregate.
There is no target or role removal.

Supported evidence lives in
`/home/akisarou/.cache/nts-landing/runs/here-14c9be89f293-1794822759513`.
The landing owner reports 739.813 s. The complete CLI invocation, including
selection, took 804.115 s. Its estimate was about 412 s; the existing per-step
ceiling was about 20.6 minutes. Tooling used 353 s, records 117 s and
gate-inputs 99 s. The unaccepted selector record required live derivation.
No bound or scheduling policy was changed, and this is no speed claim.
This run required no memory retry; the retry behavior is proved separately
by the focused controls.

## Ownership and ordering

Previously, the first attempt could release the build hold and immediately
start another synchronous candidate command. The parent could not deliver
its Worker's reply or exit events while that command blocked its event loop.
Its still-armed drain guard could consequently report an unresponsive sampler
after the check had measured green. The earlier observed symptom is retained
in [the #719 record](product-type-checks-719.md).

The async launch form shares request encoding, descriptor placement, output
capture budget and child-result decoding with the synchronous form. It keeps
the parent available while a candidate runs. The hold's close is memoized and
joined before another attempt, including failed and exceptional paths. A
primary failure and a separate drain failure remain distinct. Final contract
validation and `landing.json` publication follow the drain.

The supplied ordering control withholds Worker exit, then supplies reply and
exit before the next attempt. It advances the retry clock to 90,001 ms and
requires the unchanged guard to have been cancelled. The actual-main arm
fails the named retry-before-join assertion. This is a deterministic replay,
not a separately timed experiment or a change to the guard.

The service integration injects the real runner in its own independent private
repository. That runner checks its actual commit; a separate task repository
exercises the service's queue and publication. The test does not equate those
commit identities. The actual `--here` entry receives a host environment, and
its runner receives its private observations and controls as explicit owned
values. Cleanup follows the awaited entry, not just command construction.

## Terminal timestamps

The Worker writes its own exit-hook wall timestamp into a shared cell.
Parent-observed reply and exit times remain separate fields. The timestamp is
labelled `workerTerminalHookAt`: it is not the kernel's exact thread-death
instant and never substitutes for awaiting `closed`. A missing terminal hook
stays null when a wedged Worker is forcibly terminated. Supplied controls
distinguish hook time 23 from parent-observed exit time 29 and retain that
missing-value case. The real Worker control also requires delivery and exit
while its candidate child is still pending.

## Remaining synchronous callers

Six full-check controller calls retain their synchronous transaction contracts.
They share the exact codec with the async form, with a direct output and
child-receipt equivalence control.

| Caller | Contract retaining synchronous launch | Guard overlap census |
|---|---|---|
| `full-check/measure.ts:157` | Synchronous gate measurement inside the Cargo configuration lock | No owned live sampler/Worker guard found |
| `full-check/measure.ts:171` | Synchronous contract measurement in the same transaction | No owned live sampler/Worker guard found |
| `full-check/measure.ts:183` | Synchronous gate measurement in the same transaction | No owned live sampler/Worker guard found |
| `full-check/records.ts:129` | Synchronous applier/`applyAt` transaction | No owned live sampler/Worker guard found |
| `full-check/bench.ts:183` | Synchronous publisher/`publishAt` transaction | No owned live sampler/Worker guard found |
| `full-check/service.ts:1302` | Synchronous recorder/`recordAt` transaction | No owned live sampler/Worker guard found |

This is a source census, not a runtime proof of every controller path. The
next-cycle timer at `full-check/service.ts:1640` is armed and awaited between
cycles. Measurement ceilings belong to the separate asynchronous
`measure-command.ts` supervisor at line 52. `CommandLifetime` starts its close
guard after its body returns. No same-parent guarded Worker overlap was found
in these retained callers.

## Excluded runs

V1 stopped at three test-only strict diagnostics. V2 and V3 stopped at host
ownership refusals. V4 passed audits but the counterfactual stopped at an
installation-catalog setup refusal; it proved no retry behavior. V5 refreshed
the catalog through the real linker and obtained the intended main failure,
but only 63 of 65 fixed controls passed: the CLI had inherited outer test
policy values, and the independent service runner had been supplied the wrong
repository's commit. V6 corrected those fixture inputs and supplies the
complete focused proof. None of the earlier results is substituted for V6.

No sampler guard, gate parallelism, compiler command, CPU policy or memory
ceiling was relaxed. The workflow's landing-lifetime Decision states the
resulting ownership contract.
