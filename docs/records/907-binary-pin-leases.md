# Gate binary pin ownership

Issue #907 replaces count-only retention of shared content-named compilers.
An older wide run could wait behind higher-priority work while later gates
removed its compiler folder. The pin owner now records run leases before
exposing executable paths and retains every held folder plus ten recent
unheld folders. A single cache-wide lock covers publication, lease changes,
recency and pruning. Binary copying and hashing precede that lock.

Bundle identity hashes the sorted executable name/digest pairs, including
nts-only bundles. The run summary retains compiler provenance separately
from the bundle and member digests. A suite-only change creates a distinct
folder; identical bundles reuse one without rewriting members. Reuse checks
each member's digest after acquiring the lease, outside the lock. A mismatch
refuses without repairing or overwriting an executable another run may hold.

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

## Publication durability

Payload files and the complete holder record are flushed in private staging.
A new bundle and its initial holder become visible through one directory
rename under the cache lock. Reuse renames one already-complete holder into
the folder. No copying, hashing or fsync remains under the lock.

A power cut kills every run. Losing a lease or publication rename across that
cut is harmless: the old holder would be stale, and a missing bundle is
published again by the next run. Directory fsync is therefore unnecessary
under the lock. Every normal terminal path still drains before releasing.

## Contention and sabotage evidence

Twenty-four child processes rendezvoused before starting. Each staged a distinct
variant of a 79,204,640-byte executable in the private cache, held its lease
until all twenty-four had acquired one, then released. All twenty-four folders
survived while held; exactly ten unheld folders remained after release.
Measured lock intervals exclude copying, hashing and member verification.

| Implementation | Commit | Maximum wait (ms) | Maximum hold (ms) |
| --- | --- | ---: | ---: |
| Holder fsync inside lock | `366cf321a828b52240de48d8a090ef1a46e739f9` | 1191.483 | 619.084 |
| Complete staging outside lock | `df4ec629b7f557eb6fbcacc6c49bff725c92dd9e` | 404.654 | 2.165 |

The first arm exceeded the requested one-second wait bound. Moving complete
holder preparation and flushing outside the lock removed that serialized IO;
the second arm kept every wait below the bound. This is observed contention
evidence, not a scheduler-dependent timing assertion in the gate. Both arms
ran in named low-priority units through memory admission, outside CPUs 4–5.

Count-only sabotage changed the retention selection to include held folders.
The first retention fixture failed with the older live compiler missing
(`ENOENT`, exit 1). Restoring the exact saved source made that fixture pass
(exit 0). The committed `git log -1` was saved in a separate command before
the experiment; restoration copied the saved file and preserved its SHA-256.

Raw evidence is retained under `/home/akisarou/.cache/nts-scratch/907/`:

| Artifact | SHA-256 |
| --- | --- |
| `measurement-commit.log` | `88c605320c1b1bbdf107cafa11243dfeec0b5c6f46a73c9adaa5c6bdefe39c11` |
| `measurement-after-commit.log` | `75110ad4e6a164f2d4106bf1493ff1111af4c37076abf6e58caf952c7743ae30` |
| `concurrent-starts-before.json` | `77ebd177a32af5f33f84a5a3657de4f02ab7231f000b42064acb5db706f32a52` |
| `concurrent-starts.json` | `1bc6146a9de72a37c9af0114ea3e0f5a404a540c0a57c0755611e3fc75cb1e53` |
| `concurrent-before.log` | `7d239b334b451ee71a85a4565e0b7800e08dd9b70ff3f316652956b79d0b2f29` |
| `concurrent-after.log` | `5910e32961dc8f59ec74b6f2271c2f57b13d4aa05c7d8b54b08c4285d4f37e4d` |
| `concurrent-starts.mjs` | `49cde0c9a39bdf7b8994dca240902933e62605dcf8ef61f16730323c849a2a5a` |
| `pin-child.mjs` | `f5e03365ba76b72bcff7c277be6075e1ee5a8cdb8f92b3418004e44ade905203` |
| `sabotage.json` | `c94228dcec6aebcdf06b1be91983e1567d1a67bb2245c22d6956411db520228f` |
| `sabotage.log` | `0af168488eab28b0b6996ec2f619d0a31493762cab0b09513674f3bf2941477e` |
| `sabotage.mjs` | `aa9f91b027f04cb33832ee4e77602a5c16c1033f05e5dbeff86f3e6ab831786a` |
