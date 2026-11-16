# Pooled priority yield (#808)

An outranked pooled step closes and joins its idle workers before waiting.
Its feed retains remaining cases across generations and starts a new worker
only after ordinary memory admission and a case token. The reservation owner
returns the idle promise: a standalone job trims its own forecast; an inherited
pool leaves its parent untouched; the gate returns an idle elastic step's
historical extra beyond its observed charge and the existing margin.

## Cause and decision

The retained #719 landing/full-check snapshot shows a non-fitting 8 GiB
landing growth ahead of a wide run holding about 3.7 GiB, with about 2.9 GiB
still resident. Three census streams stopped dispatching when the higher
request appeared. `worker-pool.ts` passed the inherited reservation's priority
state to the shared feed, whose pause retained the persistent workers. There
was no draining growth for #804 to backfill. This change closes the pooled-census half of the 2026-11-16 stall. The
original queue withdrawal also did not cancel the live run; #807 covers that
withdraw half.

The four feed clients are `conformance262`, `typescript-oracles`,
`program-oracles` and the direct benchmark compile recorder. The first also
serves the TypeScript backend census. Keeping thousands of cases draining
would delay the landing; idle release and restart is the chosen boundary.

| Existing census observation | Remaining-time projection | Cold cohort plus first 500 answers, an upper bound |
|---|---:|---:|
| C | 470.826 s | 15.625 s |
| LLVM | 377.922 s | 18.450 s |
| JVM | 338.706 s | 15.385 s |

These projections use the retained progress counts/rates. The startup column
includes work after startup and is not an isolated restart measurement.
The issue card and its source/data manifest remain under
`/home/akisarou/.cache/nts-scratch/761/selector-correction/feed-yield-investigation/`.

## Ownership

The feed joins a cancelled token request and any raced grant before returning
the reserved path. One shared pause waits for all live generations to close;
resume restores an owned forecast through ordinary growth before another
worker can start. Inherited handles never shrink their parent. Active cases
finish normally. Pressure, loss, recycling and voluntary yield retain distinct
outcomes and counters.

The startup review caught a branch-introduced lost-offer defect before landing:
the initial path was counted before its worker could dispatch it. An offer now
remains feed-owned through startup. Its dispatch count commits at the actual
stdin write. An unused offer re-enters the queue only after token completion,
so even a one-case pool survives pre-dispatch pressure exactly once.

The gate sampler also returns idle elastic history. A historical extra could
otherwise remain promised after the workers disappeared. Actual live charge
and the existing margin remain covered; active case grants stay intact.
No priority, floor, margin, width, runaway bound or step ceiling is changed.

## Focused evidence

| Boundary | Actual result |
|---|---|
| Main `1d242528` feed under the same fixture | Ordinary arm passes; outranked idle-close arm fails by name |
| Fixed feed | Both arms pass |
| Branch `17b707` startup offer | Intended generation assertion fails, 1 instead of 2 |
| Fixed startup offer | One case exactly once, two joined grants/releases, old group gone before replacement |
| Frozen affected cohort at `c4fbffa8c8` | 71 pass, zero failures/cancellations/skips/TODO; strict, timing and host audits exit 0 |
| Direct compile-feed control on #719 at `78440bfe8d` | One pass; both live lanes drain, third cell stays pending, one resume, three balanced tokens, no inherited mutation; audits exit 0 |
| Final live-use owner control at `5b7431bc8f` | Three job-yield controls pass, with strict, timing and host audits at exit 0; disabling only the live-use guard fails the unwanted-growth assertion, while the unchanged fixed arm passes |
| Inner at `c4fbffa8c8` | Formatting 4 s, Clippy 72 s, build 73 s and tests 353 s, all green |
| Full tooling at `934cb616ad` | 2,777 pass, zero failures/cancellations/skips, two existing Unicode TODOs; aggregate 504.663 s |

Both historical probes load entire exact Git modules with read-only loaders;
assertions are unchanged between arms. The helper and temporary owners drain
after the green focused proofs. The 71-case cohort contains real kernel OOM,
survivor/replay, token cancellation, pre-dispatch pressure, owner forecast and
production runner-AST controls. The startup fault supplies pressure counters
and stops a real owned scope; it does not claim an actual kernel OOM.

The repeated-head control admits both higher growths without withdrawal,
requires three distinct worker PIDs and all three final rows, and keeps pressure
and replay counters zero. Its complete private observation model returns
3 GiB only after the real scopes join. That is a supplied physical-memory
model, not a measured 3 GiB allocation by the small fixture worker.

The same pool yields again when the next higher head arrives. Diagnostic live
clock readings through its owned observation capability are 65.370 ms from
readmission to `gate-b` readiness and 78.019 ms from readmission to the probe's
completed row, 143.388 ms summed with those different endpoints. These are real
lightweight-worker readings under load and exclude SDK startup. They establish
repeated reconstruction, not an SDK restart speed claim. No additional thrash
policy is introduced.

## Fixture changes and limits

The old aggregate-idle-pressure fixture used a higher waiter to keep its victim
alive. That device relied on the stall #808 removes. It now owns and joins an
explicit token hold; the exact kernel OOM, survivor, replay and scope assertions
remain. The token count includes that one fixture hold. The token-wait death
fixture first warms its victim through a real grant, because lazy startup means
an initial token waiter has no worker yet. Its exit-19 refusal, cancelled wait,
balanced releases and empty scopes remain required.

Strict-only setup failures and deliberately stopped partial runs are excluded
from green proof. The earlier repeated-head model gave a 20 GiB owner only
21.75 GiB available with the real 2 GiB floor, making it impossible even alone;
the ledger correctly let nobody yield to it. The final supplied reading is
22.0625 GiB before return and 25.0625 GiB afterwards, so the head fits alone
but waits for the live promise/physical return. No production policy changed.

The #719 rebase keeps all 13 original code blobs, all 367 literal embeds and
1,632 Rust source blobs exact. All 978 retained Cargo dep-info files exclude
its 21 changed paths; their 7,845,880 bytes are retained. The direct compile test
is absent from those native inputs. The generated selector record preserves
all 57 target declarations/roles and changes only observed gate byte facts
and their enclosing digests. It is always produced by the writer.

At proof time the user had stopped `nts-full-check` to break the shared
stalemate. Keeping it off and restarting it were coordinator/user decisions.
The workflow Decision and its dated log state the resulting ownership rule.

## Final source and supported run

The final source is `5b7431bc8f0f74638ef5a95350c7ffb04949b60b`, on landed
#806 `ea242ea92006e20f7452513a03d7b9b170089b5e`. The rebase drops the old
selector-only commit. Thirteen other code blobs stay byte-identical; the
`yieldJobMemory` block also stays exact, and removing that block leaves
`memory-ledger.ts` byte-identical to #806. The 978 retained dep-info files
exclude all 14 intervening paths; all 367 literal embed facts stay exact.
The workflow conflict retains both complete Decisions. No generated record
is merged by hand.

Writer V2 runs against the combined source and keeps all 57 target roles
exact. It changes the memory-ledger engine fact, the byte facts for
`admission.ts`, `memory-ledger.ts` and `run.mjs`, and their enclosing group/key
digests. The final live-use test is an existing file outside the record's
byte/observation inputs; its name and mode are unchanged. The retained key
check verifies that the test-only addition does not invalidate that writer
output. Its real private-ledger control requires zero forecast restoration,
zero shrink and zero growth for a live-use job, even as its observed use falls.
The hash-checked negative disables only that guard and fails, 1 growth
instead of 0.

| Final supported evidence | Actual result |
|---|---|
| Selected steps | All 20 PASS, including the build |
| Native tests | 3,078 pass, zero fail, eight ignored; frontend seven files, zero failures or unavailable |
| Tooling | 2,785 pass, zero failures/cancellations/skips, two existing Unicode TODOs |
| Gate summary wall | 639.116 s |
| Landing owner wall, rounded log | 643 s |
| Complete CLI lifetime | 707.606 s, exit 0 and no signal |
| Tooling step | 352.828 s wall, 5,213.764 CPU s, against its 1,263 s bound |
| Records / gate-inputs | 229.555 / 216.697 s wall |
| Environment and close | Canonical, no experiments; scope cleanup and diagnostics complete; temporary removed after green; unit inactive/dead-success |

These are different owner/lifetime intervals, not competing wall measurements.
No bounds changed. The run retains the known endpoint-catalog conservative
fallback: the tip is supplied the base catalog and reports a changed
`memory-ledger.ts` catalog recipe. That selector endpoint correction remains
in the separate Part of #761 slice. Its fallback does not grant narrowing.

The full tooling run at `934cb616ad` remains evidence for the pre-#806 source.
The final supported run repeats tooling on the combined final source, including
#806's joined sampler close and the added live-use control. Neither a fresh
inner nor a second writer is inferred from the test-only addition.

## Raw bindings and exclusions

The finite raw manifest is
`/home/akisarou/.cache/nts-scratch/808/raw-evidence-v1.json`, SHA-256
`f7e78a766d051da79129393aa71993e3728f111d03508d12bb82eb5931ba0f97`.
It authenticates 2,322 artifacts, 38,992,178 bytes and 240 Git receipts,
including absent paths and the exact historical modules. Its verifier rereads
all bytes and Git facts with zero errors. It includes the 978 retained
Cargo dep-info files, not copied executables.

The manifest binds the original #719 snapshot, the issue investigation, the
read-only counterfactual loaders, frozen focused and inner receipts, rebase
and selector-writer comparisons, both tooling/supported summaries and their
actual external terminal results. Earlier unadmitted stops, strict-only
failures and partial instruments remain labelled and excluded from green
proof. Readiness runs separately against the final documentation tip and
checks this finite set before the ordinary dry-run and metadata checks;
strict checking runs last. No peer whole proof is requested.

