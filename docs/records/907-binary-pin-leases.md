# Gate binary pin ownership

Issue #907 replaces count-only retention of shared content-named compilers.
An older wide run could wait behind higher-priority work while later gates
removed its compiler folder. The pin owner now records run leases before
exposing executable paths and retains every held folder plus ten recent
unheld folders. A single cache-wide lock covers publication, lease changes,
recency and pruning. Binary copying and hashing precede that lock.

## Historical writers

Lease-aware pins use the sibling namespace `nts-gate/bin-v2/<sha256>`, leaving
the old `nts-gate/bin` root unchanged. Full checks execute the gate at their
selected revision, including older `verified` revisions. A historical gate's
count-only prune never visits the sibling root. New gates never read old pins.
The compatibility fixture executes the pre-fix pruning block against thirteen
old folders and verifies it really removes three while leaving every v2 folder,
its compiler bytes and live holder intact.

`keep.json` classifies both roots as `kept`. That kind has no age-based sweep;
none of the existing sweep kinds proves an old lease-less runner has ended.
The hourly count therefore names each legacy content folder as a report-only
leftover. These folders are never added to its removable list. Their removal
awaits the user's decision after historical writers have ended.

## Consumer audit

Repository searches covered `nts-gate/bin`, path joins containing `nts-gate`
and `bin`, `identities.nts.pinned`, summary identity readers, and compiler
handoffs through `NTS_BIN` and `NTS_SUITE_BIN`.

| Reader or handoff | Ownership |
| --- | --- |
| `tooling/gate/run.mjs` | Acquires the lease before publishing `pinned` paths. Its existing resource closer releases after workers, scopes and reservation drain. |
| Runner step environment, protocol and oracle planner | Uses the runner's leased paths; all such children drain before release. |
| `tooling/census/conformance262.ts` and census workers | Consume the step's `NTS_BIN` and protocol path within that runner lifetime. Standalone invocations use their supplied compiler or the target default. |
| Oracle capture and standalone oracle commands | Capture prepares the dependency image; compiler-driving steps borrow the runner's lease. Standalone commands do not discover the gate binary cache. |
| `tooling/gate/pinned.sh` | Builds its target compiler and transfers to the runner, which acquires the content pin. It does not read the gate binary cache itself. |
| `tooling/landing/run.ts` | Passes target binaries to the runner and reads summary digests, never `identities.nts.pinned` as a later executable. |
| `tooling/full-check/measure.ts` | Passes the full-check target compiler through `pinned.sh` into the runner. Summary consumption reads run identity and verdicts. |
| Full-check recording (`service.ts`, `records.ts`) | `runPin` publishes from the full-check target into the separate `nts-pins` namespace. Recorders use that independent pin. |
| Full-check benchmarks (`service.ts`, `bench-session.ts`) | Copies `nts-bench` and `nts` from its target into the benchmark run before execution. It does not consume the gate's content pin. |
| `tooling/full-check/count.ts` | Inspects holder metadata without executing pinned binaries; unknown, corrupt and future state is named and protected. |

There is no production reader of `identities.nts.pinned` outside the runner.
The landing fixture reads its private pin bytes after completion while the
unheld recent set still retains them. No independent production consumer
needs an additional lease API.

## Controls

The retention boundary has both arms: twelve folders (two held and ten
unheld) prune nothing; thirteen (two held and eleven unheld) prune exactly
the oldest unheld folder. The older held compiler remains readable. Release
makes an old folder prunable without changing its recency. Other controls
cover dead and reused PIDs, unknown identity, corrupt and future state,
multiple holders, exact-holder release, compiler mutation during staging,
and 24 barrier-synchronized processes acquiring and releasing distinct pins.
Existing real-runner controls assert release after success, failure and
SIGTERM, including a run waiting for admission before its first step.

The hourly count uses the same ownership inspection and reports unreclaimable
leases by folder and holder path. It grants no deletion of uncertain state.
