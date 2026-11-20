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
leftover. These folders are never added to its removable list. The owner
authorized the guarded legacy sweep in follow-up #920: it may remove these
folders once `verified` includes #907 and no pre-#907 `run.mjs` is alive.
Until #920 lands, they remain report-only under their `kept` rule.

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

## Staging and detected corruption

Private staging directory names carry version 1, the complete boot/PID/start
identity and a unique token. Atomic directory creation publishes that identity
before any payload bytes, so a kill before the first copy has no unowned window.
The same locked prune that retains bundles reclaims a staging directory only
after proving its original process gone and rechecking its name and filesystem
device/inode. Live stages remain notices. Unknown, malformed and unsupported
stage names, including earlier `.staging-XXXXXX` names, remain protected warnings.
One typed `binaryPinDiagnostics` view supplies both categories to the count.

Controls cover dead and reused-PID stages, live notices that leave the count
green, unknown/malformed stages that the count names as warnings, and replacement
of a staging inode during observation. Real private publishers are paused after
directory creation and after copying, then killed through their named units with
`systemctl --user stop` and `KillSignal=SIGKILL`. Both leave their stage behind;
the next acquisition reclaims it only after the process has ended.

A member digest mismatch publishes `.corrupt-v1.json` from owned private staging.
The diagnostic is prepared and flushed outside the cache lock. Count reads its
versioned metadata without hashing executable bytes. Failed verification never
refreshes the bundle's recency, including when publishing the diagnostic changes
directory metadata. Corruption controls verify repeated refusal, unchanged
executable inode/content and recency, named count warnings, and preservation of
future diagnostic versions. Malformed and future diagnostics also protect the
unheld bundle from retention deletion; a neighboring ordinary old bundle remains
eligible for pruning.

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
| Owned staging reclamation and confirmed recency | `5da0a8fa09e7ec5eb28de83a0279e8b5ca6a94c4` | 109.374 | 18.075 |
| Final owner with read-only diagnostic retention | `f99c9fd898f8733b2b90b9f28a42222f436db0cb` | 203.915 | 4.545 |

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

The review rerun used 79,303,256-byte payloads. Its timing totals
include both publication and verified-recency lock acquisitions for each run.
All twenty-four bundles survived while held and ten remained after release.

Review sabotage separately disabled staging reclamation and restored failed-use
recency updates; each intended control failed, and exact saved-copy restoration
made it pass. Count-only sabotage was repeated on the same committed owner.

Additional retained review evidence:

| Artifact | SHA-256 |
| --- | --- |
| `review-measurement-commit.log` | `01d1b0df5e0ed8f97a766c6b19c6862320768124b73860659fe3e2e75009b142` |
| `review-concurrent-starts.json` | `0b7f1fbf844b20d9316891595f1ad19d550bec026f882f6612d5e95c22d900b1` |
| `review-concurrent.log` | `16e2735d6496f0df5f619b15c7fc9bcae6be44235cb321bd7db45dfbb16e2758` |
| `review-concurrent-starts.mjs` | `b25b28e9aefb7d641068bb139a2b18cc0f23364fdc2d18f5bd2193e1490f5c05` |
| `review-pin-child.mjs` | `f5e03365ba76b72bcff7c277be6075e1ee5a8cdb8f92b3418004e44ade905203` |
| `review-sabotage.json` | `14caacb2310d46093886ef3cd3cc1a4412fc357372431f99471eb4f924d75ae3` |
| `review-sabotage.log` | `dc929105ac81597c0c21adc189520ce83dcff4e9fb8a0c1c72a751645870a555` |
| `review-sabotage.mjs` | `1c4c0bf06cd08ca43a6174feb089263c92f4a6f4f3dc441f5d9da0751da889e8` |
| `review-focused.log` | `3c763a66cfe31090fd6bc0bb78012d8624d2c1b1d7546c504f5e58534d6a0d16` |
| `review-tooling.log` | `f0ccef814d5282e9ae0f41ce798bee1457b048e224f6e7c86846f703e239f105` |

The final owner was checked with 48 focused pin/count controls and the same
24-publisher payload cohort. A fourth sabotage arm removed future/malformed
diagnostic retention protection: the control failed, then passed after exact
source restoration. All four sabotage arms have failing and restored controls.

Final retained review evidence:

| Artifact | SHA-256 |
| --- | --- |
| `final-review-measurement-commit.log` | `729a38443c50408e5dd79482c74b3277c90b7bd7c855c2b21fa9a6481e2fe618` |
| `final-review-concurrent-starts.json` | `a3988600348912edeec40b86527df7e39394f52303bbce5be6b6240d4b1e1b3b` |
| `final-review-concurrent.log` | `d1c7c335fcfbed850f5f5b90f3dd6ad20604eeef4e23e7103ac7225e5c13207f` |
| `final-review-concurrent-starts.mjs` | `bb649d121779fa2cbd24bc7438646ea75f02417f99b4f2e5a3673ad0ee51c996` |
| `final-review-pin-child.mjs` | `f5e03365ba76b72bcff7c277be6075e1ee5a8cdb8f92b3418004e44ade905203` |
| `final-review-sabotage.json` | `e06b7c1fdd5bc0d3f0092eeb39a7b64d68c77f25dc3234535aa67efbc96035b9` |
| `final-review-sabotage.log` | `3672a7be41b82c880488bf50abd44ebcb315630bdd57c92bb314612b0b28220b` |
| `final-review-sabotage.mjs` | `0258050ddea0de87c970b0058a46b066e01e5a89f09ea099f4b67fcbb13f3ccf` |
| `review-final-focused.log` | `a31440115e7c17f498585fc5814422599b5a9f3e6ba40f3a7d547f8d748803bd` |
| `review-final-tooling.log` | `051d5672c21a8b9811cacdd9c893182c6799a13098dd3432f81c72833bef2217` |
