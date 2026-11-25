# Pool-lock transaction evidence for #1013

The incident log identifies full-check holder PID 2019416, birth identity
`267ae3c4-a308-4a47-b8aa-1198e51dc495 2019416 1075239`, in
`nts-full-check-measure-5620c884-a035-43ae-bbdd-403d1b47c046.scope`.
The landing waiter was clippy → `DiskCapacity.beginBuild` → reclamation →
the shared `~/.cache/nts-pool/.lock`. That log has no holder-phase observation,
so it cannot establish which individual scan caused the historical hold.
Source inspection and the controls below establish three long-work paths
inside the old transactions: allocation inventory, Git questions, and
unit/process ownership checks. Recursive payload draining was already outside
the lock; it is a negative control, not the attributed cause.

Allocation, Git commands, ownership inspection, checkout preparation, deletion
and reclamation-log finalization now run outside the shared lock. Transactions
capture or recheck small authoritative state and publish claims, intents or an
atomic detach. Admission validates its monotonic generation and exact claim
publication before granting. Reclamation also checks Git, registration, refs,
presence and physical identity, then detaches inside the same short transaction.
A same-filesystem rename and, for a linked checkout, two small linking-file
writes are the commit. The complete detach record is rendered and fsynced
beforehand, then published by rename. Git's move implementation confirms this
bounded primitive: [move preparation](https://github.com/git/git/blob/v2.56.1/builtin/worktree.c)
and [linking-file updates](https://github.com/git/git/blob/v2.56.1/worktree.c).
No Git subprocess or tree traversal runs in that commit.

Pool mutations retain old and prospective promises under a separate nonwaiting
operation owner. A short transaction opens a directory FD, held through Git,
lease, presence and input publication. Main's existing process-user rule sees
that pin. An operation ignores only its own validated PID/birth/FD capability;
other descriptors, including another operation's pin in the same process,
remain owners. All exits close it, including refusals; the kernel closes it
on crash. Only an operation's own unchanged empty placeholder can be removed.
The workflow specifies the current contract.

## Before and pre-review maximum hold per transaction

The before allocation/ownership source is main
`d389ae5203f189c5fcfefeed565ac1dc29183466` plus diagnostic-only instrumentation
at `cba642791a4ac698b1ac337ac0324353d9a91984`. The before Git arm stages those
instrumented modules privately. The three owner files at main
`10fe03ef3a99d67333e73bf1771f1832b4e90a6a` are byte-identical to that baseline.
The pre-review after source is committed `2d6137209cc62ae469cae4a8c115c04967526572`.
The review corrections and their replacement final measurements follow below.
Earlier after arms remain in the raw-evidence table as earlier observations.
Cited source commits are retained under `refs/cited/`.

The supplied clock advances 35,000 ms for each allocation or Git observation
and 45,000 ms for ownership preparation. Width is the number of pool trees;
each allocation tree has two declared outputs. These are deterministic charges,
not claims that those operations normally take that wall time. A separate
arm adds `performance.now()` to expose residual metadata holds. Neither arm
makes a landed test decide from elapsed time.

| Work / width | Before maximum held ms | Before / 30,000 ms wait | After supplied-work held ms | After residual maximum ms | After / wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Allocation / 1 | 70,000 | 2.33× | 0 | 0.453 | 0.00151% |
| Allocation / 4 | 280,000 | 9.33× | 0 | 0.167 | 0.00056% |
| Ownership / 1 | 45,000 | 1.50× | 0 | 56.368 | 0.18789% |
| Git / 1 | 245,000 | 8.17× | 0 | 60.705 | 0.20235% |
| Git / 4 | 245,000 | 8.17× | 0 | 60.766 | 0.20255% |
| Pool operation / 1 | 140,000 | 4.67× | 0 | 93.862 | 0.31287% |
| Pool operation / 4 | 140,000 | 4.67× | 0 | 114.272 | 0.38091% |

Git's before arm runs seven questions under each detach transaction: seven
of 17 questions at width 1 and 28 of 53 at width 4. Its boundary assertion
is false on main and true after the change: zero of 18 and zero of 57
questions run under the shared lock. The pool control charges each input,
allocation and ownership callback 35,000 ms and independently tries the lock.
Main holds it at all 13/16 callbacks for width 1/4; every after callback finds
it free. Increasing width adds separate transactions without putting a scan
inside any transaction.

The checkout arm additionally varies tracked payload from one to 256 files,
each 64 KiB, and pool width from one to four. All Git questions still acquire
the lock independently; all supplied-work holds are zero. Its live detach
maxima are below. The transaction has the same fixed metadata path set,
one rename and two linking-file writes regardless of the file count or bytes.
Scheduler and storage latency account for residual variation; these are
observations, not a latency guarantee.

| Pool width | Files per checkout | Live detach maximum ms | Fraction of 30,000 ms wait |
| ---: | ---: | ---: | ---: |
| 1 | 1 | 61.653 | 0.20551% |
| 1 | 256 | 62.444 | 0.20815% |
| 4 | 1 | 76.786 | 0.25595% |
| 4 | 256 | 105.232 | 0.35077% |

After phases, maximum live residual across the allocation, ownership, Git,
pool, checkout, waiter/handoff/readiness and interrupted-drain arms:

| Phase | Maximum held ms | Fraction of 30,000 ms wait |
| --- | ---: | ---: |
| build-admission-capture | 1.251 | 0.00417% |
| build-admission-publish | 73.963 | 0.24654% |
| build-handoff-read | 0.420 | 0.00140% |
| build-readiness-capture | 1.523 | 0.00508% |
| build-readiness-publish | 0.460 | 0.00153% |
| capacity-snapshot-capture | 0.412 | 0.00137% |
| capacity-snapshot-publish | 0.453 | 0.00151% |
| claim-release | 114.272 | 0.38091% |
| disk-wait-publish | 29.795 | 0.09932% |
| pool-operation-intent-protect | 33.215 | 0.11072% |
| pool-operation-intent-publish | 40.087 | 0.13362% |
| pool-operation-intent-retire | 35.923 | 0.11974% |
| pool-placeholder-retire | 22.483 | 0.07494% |
| pool-tree-pin | 44.754 | 0.14918% |
| reclaim-detach-capture | 1.658 | 0.00553% |
| reclaim-detach-publish | 105.232 | 0.35077% |
| reclaim-intent-publish | 37.784 | 0.12595% |
| reclaim-intent-retire | 42.855 | 0.14285% |
| temporary-admission-capture | 0.467 | 0.00156% |
| temporary-admission-publish | 40.043 | 0.13348% |
| trash-adopt | 0.422 | 0.00141% |
| trash-checkout-repair | 25.767 | 0.08589% |
| trash-finalize | 0.394 | 0.00131% |

Every transaction passes through the observer, including release. Rows name
PID, birth, unit, operation, root, phase, duration and per-holder maximum;
history appends only after unlock. The current-transaction sidecar uses a
temporary file and rename and grants no authority. Missing, empty or malformed
sidecars degrade to “holder phase unknown”; a mismatched lock holder or birth
labels the sidecar stale. A wait failure adds the matching holder transaction.
The structural guarantee is that no scan, Git process, ownership enumeration
or payload drain contributes to a pool-lock transaction, independent of payload
bytes. The review adds shallow registration metadata proportional to registered
tree count, as explicitly approved; see the replacement measurements below. Rename credits no free capacity until the trash drains.

## Competing waiter and mixed-version controls

A hand-run child tries the shared lock during ownership preparation. On the
instrumented main both the zero-wait and real 30,000 ms arms return
`LockWaitError` (exit 7); the real arm takes about 30.267 seconds. On the final
source both acquire successfully (exit 0) before preparation returns.
These counterfactuals remain in scratch; no landed test waits 30 seconds.

Main's production modules are staged with the module-closure fixture and
replaced with their exact published main bytes. The source manifest records
129 per-module hashes and the main commit. Both versions use the same fixture
claim, presence and pool files. All nine mixed-version controls pass:

- Main/new temporary admission in either order refuses a double spend and
  grants after release. Every claim publication remains schema v1.
- Main inserts a claim between new preparation and commit without advancing
  generation. Exact publication identity invalidates it and denies the second
  spend. Main's reclaimer retains a tree claimed by a new build owner.
- Main `beginBuild` immediately before new detach cancels it. Immediately
  after detach it builds fresh; its files remain outside the trash grant.
- Main `Pool.give`/reset has the same two orders: its preceding Git/presence
  mutation cancels new detachment; its following new state survives draining.
- A private-copy crash immediately after rename, before linking-file and
  record publication, leaves owned trash. Main accepts the v1 record and
  retains the unrepaired checkout. The new owner repairs the two exact links,
  drains its payload and retires Git registration.

All four main/pin controls pass using readiness barriers and named child units:

- Main reset already inside the shared lock observes no pin and finishes
  before publication. New take then selects from the reset state.
- Main reset after publication refuses by its existing open-file rule. The
  switched checkout and subsequently published v1 presence survive.
- Stopping the named take unit mid-switch closes the FD; main's next reset
  proceeds. No PID-list signal or persistent crash-recovery pin is used.
- Refusal before Git add leaves no placeholder or pin, and main takes the
  same slot on retry.

No old claim/presence reader is fenced or promoted to a new schema. Old writers
remain compatible. New owners detect their claims through pinned immutable
publication receipts, and their Git/presence/registration changes through the
final receipts. Atomic detachment closes the interval after validation; the
FD pin closes the pool-switch interval using the process contract main already
honors. Generation and intents exist only in `.lock.state.json`.

Landed controls additionally cover generation ABA, claim-inode ABA, replaced
roots, newly tracked/ignored data, newly current service output, external
service targets, independent admission during slow ownership, and deletion
charges proportional to supplied 1/16 GiB payloads outside the lock. A refused
admission's trash inspection changes no authoritative capacity state and must
not invalidate its active reclaimer. Shortfall receipts require exact positive
bytes; target-fenced receipts carry token and holder identity with no byte
fields. Mixed and unknown variants refuse by name. Both use disk-held retry,
preserving arrival until readiness observes capacity and intent retirement.

Tracked-file diagnostics deliberately precede the broader clean-tree diagnosis:
all provenance is repeated after ownership preparation, and the specific
tracked-file refusal is retained. Only that existing expectation changed.

## Focused and integration proof

The latest sequential focused run passes pin 3, process ownership 27, capacity
34 and reclamation 67 controls, plus 50 existing pool controls. The newly moved
pool barrier initially stopped at its obsolete source-injection anchor; the
updated pre-switch seam passes, including with its own supplied process
population. All 14 admission controls and all 10 receipt controls pass. The receipt control is run with the fresh
inner compiler explicitly supplied to its native-checker case; its initial
attempt stopped at setup because the default release binary is absent.
Strict tooling types checks 1,226
modules across six projects with no diagnostic increase.

The private-main fixture initially failed to offer task output because it
lacked the required Cargo cache tag. Adding the tag deliberately offers the
whole target, and its assertion now names that exact root. The resulting nine
controls pass. These were fixture corrections; the main production modules
were never patched. The four pin controls also pass.

A separate main control reproduces #927: the CLI fixture observes another test
file's non-dumpable child on the real host and correctly exits 75. The
coordinator attached that log and driver to queued #927. That existing CLI
fixture is unchanged. Sequential per-file focused proof is approved; landing's
tooling step retains ordinary parallel execution.

Claim release completes its state removal and unlocks before raising an
unchanged clock-observation error. Four build/temporary × first/last read
controls check the named ENOENT, durable empty claims, available lock and a
following granted admission. Fixtures release locally before removing their
observation capability. The first historical --here completed its other steps,
including 3,221 Rust tests, but exposed that fixture cleanup order; the order
and release guard are now covered by the focused controls. The final `inner.ts --no-agree` passed formatting (4 s), Clippy (10 s),
a fresh compiler build (24 s), and 888 selected C, LLVM, JVM and differential
tests across 14 reported groups (992 s), with zero failures or ignored cases.
Subsequent receipt-control and evidence commits change no Rust source.

## First review: receipt coverage and compatibility

The reviewed source `0717a8c309b9f5280318393b7589eb8c2d0e1d38` missed four
contracts. Pool operations fenced unrelated trees; kind-less v1 disk-held rows
were rejected; main's claim-less take could evade admission receipts; and
metadata-only pins advanced the generation while retries went unobserved.
The corrected executable source is `99a6d015708b7df85951ecec057e683b898319dd`.
The private-main controls use exact production modules from main
`f12c78199d6dffe382a33fc75b5dcd2a110a3aea`, with 129 file hashes in their manifest.

A selected-tree intent now leaves an independent process's unrelated build and
temporary admission eligible. Both exact old shortfall rows and named current
variants normalize before step-result storage and queue retry. A persisted old
queue result survives restart and lands at its original arrival position.
The first focused run exposed a validator that discarded its normalized return:
its new receipt control failed at the missing kind before the assignment fix,
then passed afterward. Zero shortfalls, mixed byte/fence fields and unknown
variants remain named refusals.

All registered pool trees, including free trees, contribute Git/presence receipts.
Capture and publish also compare the shallow registration namespace, entry
inodes, gitdir targets, HEAD and optional locked markers. No timestamp-only
comparison, Git subprocess or checkout traversal is used. Actual main's take
against new temporary and build admission passes in both orders. The exact
add B, add C, give B, reclaim B sequence invalidates preparation because C
remains registered. The same controls against the reviewed source fail with
three double grants and the legacy reader refusal (four failures, two controls
passing). They use readiness seams, not elapsed time to decide the result.

All 15 mixed-main controls and all four FD-pin controls pass. They retain the
before/after detach orders for main beginBuild and give/reset, rename-before-record
crash recovery, reset before/after FD publication, kernel FD release on process
death, and new-slot refusal without a placeholder. Neither reader refuses the
other's v1 claims or presence; no old writer is fenced by a new schema. Claims
are detected by immutable publication receipts, legacy take/give/reset and raw
Git changes by all-tree Git/presence/registration receipts. The bounded atomic
detach and the kernel FD pin close the intervals after validation.

Generation advances only for changed claims, intents or leases. Pin/placeholder
transactions, duplicate releases, duplicate intent protection and repeated intent
retirement leave it unchanged. Three supplied-clock invalidations force four
preparations and expose attempts 1–4, retries 1–3, invalidation cause, 35,000 ms
per outside observation and 140,000 ms elapsed, with zero supplied work held.
This measures possible admission starvation without introducing a longer wait.

Sequential focused proof passes capacity 42, reclamation 67, pool 53, service 33,
receipt 11, admission 14 and pin 3 controls. The 41-case capacity run is followed
by the added idempotence case and four expanded clock-release cases. Types pass
all 1,226 modules across six projects. The existing host-process CLI fixture and
canonical-environment fixture are unchanged (#927 and #1001 respectively).

### Replacement per-phase maxima

The supplied-clock allocation, Git, ownership, input and payload charges remain
outside every shared transaction. All supplied-work holds are zero. The residual
arm uses the same operation charges plus performance.now(); rows below are
observations rather than a wall-clock guarantee. Before rows use the same main
source and controls already cited above.

| Work / width | Before max ms | Before / 30,000 ms | After supplied ms | After residual max ms | After / wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Allocation / 1 | 70,000 | 2.33× | 0 | 1.039 | 0.00346% |
| Allocation / 4 | 280,000 | 9.33× | 0 | 0.177 | 0.00059% |
| Ownership / 1 | 45,000 | 1.50× | 0 | 155.453 | 0.51818% |
| Git / 1 | 245,000 | 8.17× | 0 | 122.090 | 0.40697% |
| Git / 4 | 245,000 | 8.17× | 0 | 123.437 | 0.41146% |
| Pool operation / 1 | 140,000 | 4.67× | 0 | 141.335 | 0.47112% |
| Pool operation / 4 | 140,000 | 4.67× | 0 | 122.483 | 0.40828% |

| Phase | Maximum held ms | Fraction of 30,000 ms wait |
| --- | ---: | ---: |
| build-admission-capture | 6.906 | 0.02302% |
| build-admission-publish | 122.483 | 0.40828% |
| build-handoff-read | 0.401 | 0.00134% |
| build-readiness-capture | 0.284 | 0.00095% |
| build-readiness-publish | 0.334 | 0.00111% |
| capacity-snapshot-capture | 3.228 | 0.01076% |
| capacity-snapshot-publish | 3.404 | 0.01135% |
| claim-release | 127.796 | 0.42599% |
| disk-wait-publish | 19.315 | 0.06438% |
| pool-operation-intent-protect | 51.705 | 0.17235% |
| pool-operation-intent-publish | 141.335 | 0.47112% |
| pool-operation-intent-retire | 115.946 | 0.38649% |
| pool-placeholder-retire | 0.752 | 0.00251% |
| pool-tree-pin | 0.750 | 0.00250% |
| reclaim-detach-capture | 8.278 | 0.02759% |
| reclaim-detach-publish | 123.437 | 0.41146% |
| reclaim-intent-publish | 155.453 | 0.51818% |
| reclaim-intent-retire | 57.477 | 0.19159% |
| temporary-admission-capture | 0.466 | 0.00155% |
| temporary-admission-publish | 41.809 | 0.13936% |
| trash-adopt | 0.410 | 0.00137% |
| trash-checkout-repair | 29.244 | 0.09748% |
| trash-finalize | 0.554 | 0.00185% |
| pool-membership-capture (component; max at 4 entries; sweep 0/1/4/13) | 6.623 | 0.02208% |
| pool-membership-recheck (component; max at 4 entries; sweep 0/1/4/13) | 25.415 | 0.08472% |

Components belong to their enclosing transaction and are not added again.
The greatest residual hold is 155.453 ms (0.51818% of the wait). Checkout detach
for width/files 1/1, 1/256, 4/1 and 4/256 peaks at 101.904, 98.343, 105.469 and
76.916 ms respectively. The rename and two linking-file writes do not traverse
the payload. The shallow registration arm varies 1/4/13 entries and 1/256 files
of 64 KiB per checkout. Its enclosing capture/publish maximum is 0.485/0.277 ms
at one entry, 1.093/1.149 ms at four, and 3.345/3.404 ms at thirteen (one/256
files). Its cost follows registered metadata count, not checkout contents; this
bounded exception to tree-count independence was approved explicitly.

### Renewed integration proof

On the corrected owners, `inner.ts --no-agree` passes formatting (5 s), Clippy
(6 s), a fresh compiler build (13 s), and 888 C, JVM, LLVM and differential tests
across 14 reported groups, with zero failures or ignored cases (1,027 s).
Input-link memory admission waited 1,002 s; oracle-capture disk admission waited
165 s before its 9,385 ms capture. These waits are separate from execution.
The source was frozen through the named unit's successful drain. The coordinator
freed regenerable Node caches and tracked landing-target incremental churn as
#1022; no manual shared cleanup or unit stop was performed by this worker.

The original `check.ts --here` on reviewed commit
`0717a8c309b9f5280318393b7589eb8c2d0e1d38` passed 19 of 20 steps. Only tooling
was red: #1001's known canonical-environment priority/oracle case hit its 120 s
bound under the full tooling step. The coordinator owns renewed landing proof
following review; no second --here was queued or run by this worker. The
canonical-environment fixture remains unchanged. That original run also passed
3,227 Rust tests with 8 ignored and all seven native-checker test files.

### Review raw evidence

All paths below are under `/home/akisarou/.cache/nts-scratch/1013/`.

| File | SHA-256 |
| --- | --- |
| `review-inner.log` | `099fe6884ac9e27620709a66c789a471b209c2bcc8b2c6bdc8d6194d7895a9d5` |
| `review-inner.mjs` | `e4bfa1b18930474623f1da4d8f4e78617d7fd777ea3807ceffa2613e1350e832` |
| `run-inner-final.mjs` | `a6f3cf3823d7e7171beb4f87e5b3656d5eeef3681bf096fd48dbeeb37ecd8ed0` |
| `review-main-stage-ripqX8/main-source.json` | `cceb09e6ca1601d431f4b61195014d70dd44d998bd58f1bfd8a64288cb4cf16e` |
| `here-final-tooling.log` | `81c15e67f7ebffcb6da2e8d3c6c2b87f531080843af5a1d94708935dc7041749` |
| `here-final-summary.json` | `e3dfc8e30d0e4b752c5080f61ec00c6a21875d4ec030caffffad8e1cfea26d31` |
| `here-final-tests.log` | `8f3437e7c6589652530469ebe7204035b2af31d15432005a8a7ced2d434fc570` |
| `check-here-final3.log` | `4afff61103185b45caf450e2c4008dc01b3e83e5a95ba5186956960ccd48423a` |
| `review-focused1.log` | `a5b655a110460d7ce0314fd3e2801dedd931eaf8400aa35023596915a1523d09` |
| `review-proof1.log` | `0b4e6818b266620aaa3fdff22e02b6ed4439a351ca49878837dbec5eaf4584c4` |
| `review-main-controls.mjs` | `651189b810d26fabe96d09ef9baadab1e6a31edfaaad34604032f0d6ec6eaf08` |
| `review-main-controls.log` | `4d6aaee3a41f1baae1dfce0ad65b93a569b1b1d026c00744927ef23d9077f65d` |
| `review-main-pins.mjs` | `339a0f9a21a4d41288385707f67a31a2024170000c9f2458e55cc829cab5f086` |
| `review-main-pins.log` | `63be75b7b37b0a744bee19e403133541bf5d8ebe31b72867fef6ec4436d837a3` |
| `review-stage-counterfactual.mjs` | `534855e73a6a22a74f88de95e28f750e39b3749669b44707a520827f93a57cf2` |
| `review-counterfactual.log` | `3b3d1e5b3762596520e2674045f379fbcc51a57215d08eda0678c9c31f0b6b73` |
| `review-main-current.json` | `496b7933f4f3c301a8736da26fc5323716373e4d5e0115752edb86196bcdcb2e` |
| `review-counterfactual-source.json` | `611767734a14beda9a7f443bea6a305024b88e5f88ec709c06f2d760d3cf5702` |
| `review-measurement-driver.log` | `1078898d724f2b461e4066d68dd25ebdda61c7708eca53dab552f6f130a58f01` |
| `review-run-measurements.mjs` | `1828e461ee9b45bff3f74e18d9c83056aecb91df953cfadd31bd794dd62bfc00` |
| `review-membership-measure.mjs` | `8b9df37fc22a0a7eca5f6626922569867d87491d1c75da4337db59ad5301ee12` |
| `review-phase-summary.json` | `2e4c67aa25c1f9fdd09a988833cbc7aa7ca37f5d76d1e9162a18db3eff1b34b9` |
| `review-summarize.mjs` | `9cb493be75ba6fbc0134052ae1fd7760d17595752ec518ab78fd6be3a65ca03d` |
| `review-final-after.log` | `ba9b146237bbe50e0d921cc7a6b1933d3c3ad57b3b77b8d996725c430fd2ebc0` |
| `review-final-after-live.log` | `953a7a4f4700e06927f5482bab7e8997eca3e104e13d0563179c53d7f6d87af4` |
| `review-final-git.log` | `813cd56354f006aed53615f266329c8dbb09695ecd19c49d2d217a528f1c2289` |
| `review-final-git-live.log` | `a565f4036692cbe68286222b5b94347189c6475ad9b5246dda692c17395acbba` |
| `review-final-pool.log` | `bf00b15edba3d143328ac754b61d608fb12565a331ab7992c293753c5c3bdd4b` |
| `review-final-pool-live.log` | `79671dd82588ad2d95340dabd6e1390f24824786889812bc6da3c31ce9179eec` |
| `review-final-checkout.log` | `735d0c8c6077d38d4fc5138133c08d9c4496cfb1e0150e0758eabe6f20dec9f4` |
| `review-final-checkout-live.log` | `169b0bf77c9db779aec75a697a36fd13658e0a6053df36f10e3d36f1ba5dd2c0` |
| `review-final-metadata.log` | `a271e1e31549b28d8db72ab48c00622f587a78c7534d6670afc1fd77ea30acab` |
| `review-final-membership.log` | `f0c893edc81a340817e6b9950cb47aa70bb595ad87f8d1251e34ebe338292afc` |

## Second review: partial registrations and admission scope

The second-review executable owners are committed at
`6d0d043b11da6e031b569b532af6f38908824582`; the final evidence/packaging edit
changes no tooling bytes. The second review found two remaining defects:
complete-only namespace parsing threw on Git initialization/removal windows,
and full receipts on every pool tree invalidated admission on unrelated index
and input activity.

Registration capture now records partial/negative metadata and an entry that
vanishes after enumeration. A changing or unstable receipt cancels preparation
instead of throwing. A stable missing/empty gitdir names no pool lease. This
matches [Git 2.56.1's linked-worktree reader](https://github.com/git/git/blob/v2.56.1/worktree.c#L130-L163),
which skips entries with no readable nonempty gitdir. The receipt still observes
partial fields so later completion invalidates it; no repair or prune runs here.

Other pool slots now contribute lease identity only: root/pointer, registration,
HEAD/ref, landed ref, packed-ref publication and worker presence. Directory size,
index, Cargo/toolchain inputs and completion files are excluded. The request's
own build/readiness tree and reclamation candidates keep their full receipts.
The namespace supplies each lease's authoritative admin path. This also covers
a new checkout's briefly empty working-tree Git pointer without dropping its
ref observation. Missing HEAD on an identified pool lease invalidates until
initialization completes; unidentified partial entries cannot cause that loop.

Fourteen added controls pass:

| Event | Observed result |
| --- | --- |
| Stable initializing-only registration | Temporary, build, build-readiness and snapshot all proceed; no retries |
| Removal after enumeration, before metadata | Invalid receipt, no exception; next stable capture admits |
| Non-pool add, remove or completion during preparation | Each cancels once, then retries successfully |
| Empty non-request Git pointer | Registered promise remains visible; no parse failure |
| Ref change while that pointer is empty | Captured admin/ref receipt invalidates and retries once |
| Identified pool HEAD completes during preparation | Cancels once, then observes the attached lease |
| Eight unrelated index rewrites plus Cargo/toolchain/untracked edits | One preparation, zero retries, 140,000 ms supplied outside work |
| Same edits in the request tree | Two preparations, one retry, 280,000 ms supplied outside work |
| Non-request HEAD, ref, landed ref or presence changes | Each still invalidates its lease receipt |

The index/input pair has zero supplied lock work in both arms. Against the
reviewed `0abec074d4336b84c2077d979273417701b71a56` production modules staged
privately, six regression arms fail as required; the own-tree control passes.
The failures are stable initializing-only and completing entries, unrelated
index activity, both empty-pointer/ref cases, and missing HEAD. The old
unrelated-edit arm repeats its allocation observation, exposing the scope bug.
No elapsed deadline decides these controls.

Sequential focused proof passes all 237 cases: capacity 56, reclamation 67,
pool 53, service 33, receipt 11, admission 14 and tree pin 3. Strict types pass
all 1,226 modules across six projects. All 15 actual-main mixed-owner controls
and all four FD-pin controls pass again. Main's exact production manifest is
bound to the current-source pointer and its per-file hashes. Shared claim and
presence schemas remain v1; no old writer is refused by a new schema.

The first new pin-driver attempt stopped before its barriers: main's newer
host-observation reader required unitUsers. Only the private fixture packet was
extended with a supplied fixed empty unit view; main's production modules were
not patched. The first partial inner was stopped by its own named unit to close
the adjacent empty-pointer window. That interrupted run is not completion proof.
The final source stayed frozen through the successful named unit's drain.

The renewed `inner.ts --no-agree` passes formatting (3 s), Clippy (3 s), fresh
compiler build (4 s), and 888 C, JVM, LLVM and differential tests in 14 reported
groups, with zero failures or ignored cases (996 s). The admitted focused/proof
batch waited 684 s before execution. No short timeout included that admission
wait. Landing proof remains with the coordinator, as requested by review;
#1001's original --here result and unchanged #927 fixture remain documented above.
No additional --here or landing queue action ran.

### Final before/after and per-phase maxima

The before source and raw main counterfactual remain those documented above.
All supplied allocation, Git, ownership, input and payload charges remain
outside every after transaction. Residual values below are observations rather
than elapsed-time test assertions or a latency guarantee.

| Work / width | Before max ms | Before / 30,000 ms | After supplied ms | After residual max ms | After / wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Allocation / 1 | 70,000 | 2.33× | 0 | 1.055 | 0.00352% |
| Allocation / 4 | 280,000 | 9.33× | 0 | 0.381 | 0.00127% |
| Ownership / 1 | 45,000 | 1.50× | 0 | 21.220 | 0.07073% |
| Git / 1 | 245,000 | 8.17× | 0 | 49.561 | 0.16520% |
| Git / 4 | 245,000 | 8.17× | 0 | 30.639 | 0.10213% |
| Pool / 1 | 140,000 | 4.67× | 0 | 31.869 | 0.10623% |
| Pool / 4 | 140,000 | 4.67× | 0 | 54.233 | 0.18078% |

| Phase | Maximum held ms | % of 30,000 ms wait |
| --- | ---: | ---: |
| build-admission-capture | 1.841 | 0.00614% |
| build-admission-publish | 29.106 | 0.09702% |
| build-handoff-read | 0.576 | 0.00192% |
| build-readiness-capture | 0.149 | 0.00050% |
| build-readiness-publish | 0.188 | 0.00063% |
| capacity-snapshot-capture | 2.103 | 0.00701% |
| capacity-snapshot-publish | 2.037 | 0.00679% |
| claim-release | 64.507 | 0.21502% |
| disk-wait-publish | 34.006 | 0.11335% |
| pool-operation-intent-protect | 16.437 | 0.05479% |
| pool-operation-intent-publish | 16.865 | 0.05622% |
| pool-operation-intent-retire | 16.938 | 0.05646% |
| pool-placeholder-retire | 0.292 | 0.00097% |
| pool-tree-pin | 0.611 | 0.00204% |
| reclaim-detach-capture | 1.762 | 0.00587% |
| reclaim-detach-publish | 72.038 | 0.24013% |
| reclaim-intent-publish | 71.833 | 0.23944% |
| reclaim-intent-retire | 30.140 | 0.10047% |
| temporary-admission-capture | 0.463 | 0.00154% |
| temporary-admission-publish | 36.651 | 0.12217% |
| trash-adopt | 0.391 | 0.00130% |
| trash-checkout-repair | 22.593 | 0.07531% |
| trash-finalize | 0.755 | 0.00252% |
| pool-membership-capture (component; max at 13 entries) | 1.971 | 0.00657% |
| pool-membership-recheck (component; max at 13 entries) | 1.788 | 0.00596% |

Registration components belong to their enclosing holds and are not added a
second time. Their cohorts cover 0/1/4/13 registrations. The greatest residual
hold and detach commit are both 72.038 ms, 0.24013% of the unchanged 30 s wait.
The pin and placeholder transactions peak at 0.611 and 0.292 ms respectively.
No scan, Git process or deletion runs under that lock.

| Pool width | Files per checkout (64 KiB each) | Detach maximum ms |
| ---: | ---: | ---: |
| 1 | 1 | 31.638 |
| 1 | 256 | 39.967 |
| 4 | 1 | 61.160 |
| 4 | 256 | 72.038 |

| Registrations | Files per checkout (64 KiB each) | Enclosing capture/publish maximum ms |
| ---: | ---: | ---: |
| 1 | 1 | 0.535 |
| 1 | 256 | 0.297 |
| 4 | 1 | 1.046 |
| 4 | 256 | 1.171 |
| 13 | 1 | 1.012 |
| 13 | 256 | 2.103 |

The shallow metadata work scales with registered count, as approved, and never
walks checkout contents. The detach primitive stays one rename and two small
linking-file writes, independent of payload. The earlier real main 0/30 s waiter
counterfactuals still fail on main and acquire on the corrected owners; no
30 s waiter runs in a landed tooling test.

### Second-review raw evidence

All paths below are under `/home/akisarou/.cache/nts-scratch/1013/`.

| File | SHA-256 |
| --- | --- |
| `round2b-focused.log` | `3320f8748955239795b0f485e46ea56d389316ebbcc457ac872b09528de481be` |
| `round2b-proof.log` | `2c7edcc565271cd3e67054ca8068557a5ccea16405e57b45a5aa1c5cd7d303c2` |
| `round2b-batch.log` | `7ad2cbbfdca43a0495fe00877b79fa0d69170fc0bc9d82606e74753038f5d961` |
| `round2b-inner.log` | `9336d70aa25d0f4f63f035d5de831b0c2d4b8922ff0d1639b7e4c5a31ed30d01` |
| `round2b-final-run.mjs` | `c6adc61984b4948563eec9c257ee45469c9e3f1dde706c1cabaa2005c2d7bd65` |
| `round2b-admitted.mjs` | `e2a066de96cac0a7bfeff0ba40f1cc16fdaf443e29b9a1c53c9ee4e3cad6e11f` |
| `round2b-focused.mjs` | `1e29684c6530d88876791362dfc32d1aa9f6849091e8987e9c678c03a170cecd` |
| `round2b-proof.mjs` | `aa6bf3e31098b12e1ab34187c13b0e8aee1e482298dc5aceb2389c1995604d5e` |
| `round2b-main-controls.mjs` | `565e071b14247a125bda8383c1d46666001ea60cb620b55a92bd7e895b045c4a` |
| `round2b-main-controls.log` | `837bb2de54aaa83c136cef7ca79126c7e35454f80f296e5c0bae167ca31b36d0` |
| `round2b-main-pins.mjs` | `c35f7023c3a846e12fc731c1300127b2382d187731afdb4e3a98c1a0f75fc139` |
| `round2b-main-pins.log` | `ab93b591bb4f66920d5a0edc091439b46809cdadb41f635e6a89217f7564ff61` |
| `round2b-main-current.json` | `5bd981429a0833e0ff98720ffc83cb18e6505639ba07b3bc1fb083401e4fe0ae` |
| `round2b-counterfactual.mjs` | `40759df5dc46ba916f0ad3b128e7b1035addd827cc932281761989b47da680e0` |
| `round2b-counterfactual.log` | `a03e02ffec8259a3a2188d4a9b638cc355a19fe1b537c7478502312b8b9d4b50` |
| `round2b-counterfactual-source.json` | `d43f7d7f26587800f11492ecaf92ea247ca497c7279cd792fefc447ff0be1917` |
| `round2b-run-measurements.mjs` | `c87ca2b0c17da6e686955cb5617044e314d229e479c8d7f72f055bc8ca383351` |
| `round2b-measurement-driver.log` | `69989b34ad82c8fdda1b5f91b287bdeab100e0378d11d6693fbc9f55996daff4` |
| `round2b-phase-summary.json` | `f43efe9da16b5a7ed26ec3cc3c5b2d369a07e532e46d6cb52248541adb25eb17` |
| `round2b-entry-maxima.json` | `8d9a04e3f4917dd18e350a9b2748db38b10ff1962e8f832f752409b5ba13c867` |
| `round2b-summarize.mjs` | `e59cdcd35d87c72faae7fea7a8b563eb7d987b84fbd2a4ab43ae0c94dbf8f720` |
| `round2b-membership-measure.mjs` | `8b9df37fc22a0a7eca5f6626922569867d87491d1c75da4337db59ad5301ee12` |
| `round2-focused.log` | `ba48acb866c381691397e874fb672fb760237ea959c63f7c9c3eb59a7b7bfdd1` |
| `round2-main-pins.log` | `a3f01b57ba6f79beb94d409e9e21257edd53db19f2492f2de42f1605a73f27e9` |
| `round2-main-pins2.log` | `c478bf2b631ce80d6540d4f9bc8fb6669610c459c6f345a7f66ea58f35657cfa` |
| `round2-inner.log` | `f08ddf586d051cc124065e489df11208f7d7ea2c6863d041daabe5b349ea6a43` |
| `round2b-final-after.log` | `0964a8fc8a954a02fe33457d25cb5e69a47536a88642b7470c0c0cab91aecc4e` |
| `round2b-final-after-live.log` | `3fc5b0ebfed9853c3e891b8ad9ad8859e06c3a76f2cfed2bd4887d71c7c66449` |
| `round2b-final-git.log` | `0c0066ca90961e356117707dcddebac8a15a48f72064c0dd6719f9b15a47f7d5` |
| `round2b-final-git-live.log` | `b6589829c121f75921cd832b314186926b5db395412abb3602c5d15b55acdcd3` |
| `round2b-final-pool.log` | `ce840248958c15566f85c0820a1058fd491617adcb3d65ca7a36f9a634b7025b` |
| `round2b-final-pool-live.log` | `6affad1a502944e87814dc8d7bf1e62f853856ec7ab436b0953c21b1bfe60ccc` |
| `round2b-final-checkout.log` | `003cce058ebf5506444d9ef7c0fd9d5629a302a4fb1b4a02bb5db90adb253768` |
| `round2b-final-checkout-live.log` | `cf9f3ad9bdc1a0b5ae9587852141266313fa574ca9549c74ab8b2ecc7d9749c5` |
| `round2b-final-metadata.log` | `43e48a2f64621a67f3ac100f69ff1cb4b07264318415523b4abd9389467c723c` |
| `round2b-final-membership.log` | `d5d367765a3cd327c313a92fafc38bf3894c45fba231472da9fb083381241363` |
| `round2b-main-stage-IrybB9/main-source.json` | `7dbc6cfd4307358f3187e84b9995077b860d1c329d0415b60c4e211abc504f32` |
| `round2b-counterfactual-stage-Zllpcw/source-manifest.json` | `9993599a01c35e2d90a19843c611d594425b8c3e3a5136fffc4fc65eac1e197a` |

## Third review: stable broken HEADs are observed values

The preceding incomplete-HEAD rule was wrong for persistent state. Setting the
lease receipt's unstable flag for every empty/missing HEAD or invalid ref made
all pool admissions repeat preparation indefinitely, although Git reports that
slot without a branch and activeLeases names no lease. The earlier completion
control did not expose a HEAD that remained broken throughout preparation.

Executable source `3c9e97c358be626abc05fc060082039f370c1aa9` removes only those
two forced unstable assignments. The already-captured HEAD metadata compares by
equality. Stable broken values validate; a later HEAD write still changes the
receipt and cancels preparation. Actual read races/disappearing entries retain
their unstable marker. Candidate/request checks remain unchanged. This supersedes
the second-review paragraph about waiting until an identified HEAD is observable;
the workflow and a new append-only decision entry state the corrected contract.

Three persistent-state controls use two registered slots, damage the other
slot's HEAD, and retain that state through every route:

| Other slot HEAD | Snapshot | Temporary admission | Build admission | Build readiness |
| --- | --- | --- | --- | --- |
| Empty | 2 transactions, 0 retries | 2, 0 | 2, 0 | 2, 0 |
| Missing | 2 transactions, 0 retries | 2, 0 | 2, 0 | 2, 0 |
| Unparsable ref | 2 transactions, 0 retries | 2, 0 | 2, 0 | 2, 0 |

Each route has one capture and one publish; claim release is a separate operation.
Snapshot names no lease for the broken HEAD, while readiness still includes the
healthy explicit request. A structural guard refuses more than four admission
transactions, so a spin fails promptly without an elapsed-time verdict. Against
exact privately staged `4eeb2b8eec8dcda8a056088d63f3409f3454f39f` production
modules, all three controls fail that guard. The retained
completes-during-preparation control passes, observing its one required retry.
On the fixed source all four controls pass. No production retry cap, pause or
longer lock wait was introduced.

All 240 sequential focused controls pass: capacity 59, reclamation 67, pool 53,
service 33, receipt 11, admission 14 and FD pin 3. Strict types pass all 1,226
modules across six projects. Actual-main mixed-owner controls pass 15/15 and
FD-pin controls 4/4 again; old-writer compatibility, detection, atomic detach
and kernel-pin orders remain those proved above. Shared claims/presence remain
v1; neither lock.ts nor pool-presence.ts changes.

The renewed `inner.ts --no-agree` passes formatting (7 s), fresh compiler build
(5 s), and all 888 tests in 14 groups, with zero failures or ignored cases
(tests 722 s). Its Clippy phase passes in 944 s including 938 s waiting for memory
admission; the admitted focused/proof batch waited 359 s. Those waits are not
execution failures. Source stayed frozen through the successful named unit's
drain. Landing proof remains with the coordinator; no new --here or queue action
was taken, and the prior #1001 result and unchanged #927 fixture remain as above.

### Third-review before/after and phase maxima

The original before source and main held-lock counterfactual are unchanged.
All after supplied allocation, Git, ownership, input and deletion work stays
outside the shared lock. Residual timings are observations, not latency promises
or elapsed-time test verdicts.

| Work / width | Before max ms | Before / 30,000 ms | After supplied ms | After residual max ms | After / wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Allocation / 1 | 70,000 | 2.33× | 0 | 1.128 | 0.00376% |
| Allocation / 4 | 280,000 | 9.33× | 0 | 0.391 | 0.00130% |
| Ownership / 1 | 45,000 | 1.50× | 0 | 56.614 | 0.18871% |
| Git / 1 | 245,000 | 8.17× | 0 | 51.149 | 0.17050% |
| Git / 4 | 245,000 | 8.17× | 0 | 41.730 | 0.13910% |
| Pool / 1 | 140,000 | 4.67× | 0 | 53.971 | 0.17990% |
| Pool / 4 | 140,000 | 4.67× | 0 | 62.507 | 0.20836% |

| Phase | Maximum held ms | % of 30,000 ms wait |
| --- | ---: | ---: |
| build-admission-capture | 2.295 | 0.00765% |
| build-admission-publish | 45.411 | 0.15137% |
| build-handoff-read | 0.400 | 0.00133% |
| build-readiness-capture | 0.228 | 0.00076% |
| build-readiness-publish | 0.253 | 0.00084% |
| capacity-snapshot-capture | 1.747 | 0.00582% |
| capacity-snapshot-publish | 25.314 | 0.08438% |
| claim-release | 73.391 | 0.24464% |
| disk-wait-publish | 22.162 | 0.07387% |
| pool-operation-intent-protect | 23.995 | 0.07998% |
| pool-operation-intent-publish | 27.909 | 0.09303% |
| pool-operation-intent-retire | 24.954 | 0.08318% |
| pool-placeholder-retire | 0.265 | 0.00088% |
| pool-tree-pin | 0.742 | 0.00247% |
| reclaim-detach-capture | 1.531 | 0.00510% |
| reclaim-detach-publish | 118.163 | 0.39388% |
| reclaim-intent-publish | 50.806 | 0.16935% |
| reclaim-intent-retire | 55.288 | 0.18429% |
| temporary-admission-capture | 0.403 | 0.00134% |
| temporary-admission-publish | 42.943 | 0.14314% |
| trash-adopt | 0.443 | 0.00148% |
| trash-checkout-repair | 25.999 | 0.08666% |
| trash-finalize | 0.712 | 0.00237% |
| pool-membership-capture (component; max at 13 entries) | 1.585 | 0.00528% |
| pool-membership-recheck (component; max at 13 entries) | 1.434 | 0.00478% |

The maximum residual hold and detach commit are 118.163 ms, 0.39388% of the
unchanged 30,000 ms wait. Pin and placeholder peak at 0.742 and 0.265 ms.
Registration components are already inside their parent holds and are not added
again; cohorts cover 0/1/4/13 entries. No held work scales with checkout payload.
The approved shallow metadata exception scales only with registered count.

| Pool width | Files per checkout (64 KiB each) | Detach maximum ms |
| ---: | ---: | ---: |
| 1 | 1 | 118.163 |
| 1 | 256 | 91.770 |
| 4 | 1 | 97.567 |
| 4 | 256 | 108.316 |

| Registrations | Files per checkout (64 KiB each) | Enclosing capture/publish maximum ms |
| ---: | ---: | ---: |
| 1 | 1 | 0.389 |
| 1 | 256 | 1.176 |
| 4 | 1 | 0.788 |
| 4 | 256 | 25.314 |
| 13 | 1 | 1.713 |
| 13 | 256 | 1.747 |

### Third-review raw evidence

All paths below are under `/home/akisarou/.cache/nts-scratch/1013/`.

| File | SHA-256 |
| --- | --- |
| `round3-focused.log` | `eee913bcfd1f3ddfde7ff474e628b342e8e4563e04049ca349a90cdd5e5bd33d` |
| `round3-proof.log` | `48af309e1771a7bac63a59fa25078a488fb377fe813ae6283c518dcccd3ccf31` |
| `round3-batch.log` | `e02657b49095463fdd7270583553fe9bda6df64bb71a423fa7bd8cbe18ef3192` |
| `round3-inner.log` | `4d6087c5e497db894580b7348f1a3769b3994baad23df92214f825e7c95f7874` |
| `round3-final-run.mjs` | `79697810a3e383b391dd4ad7d01b69c193e90602c97c78b2dd9961b3d9162cf6` |
| `round3-admitted.mjs` | `a023b9673c014870512938793d7f64b363adef003bc55a3710a7096aa3a96cb7` |
| `round3-focused.mjs` | `1e29684c6530d88876791362dfc32d1aa9f6849091e8987e9c678c03a170cecd` |
| `round3-proof.mjs` | `d3481fc8a493145a3f12100993dac183c5483bd868a5b6ce1dad91539b60fa20` |
| `round3-main-controls.mjs` | `3d35b07a7e1b4bec58e2155d2dea54c443c10972c9e87424e3feb577bc7fef9e` |
| `round3-main-controls.log` | `232892071fb60c1fdc1763183e0751d2a8fea0a7a0c65a288344dcc6a9a53cde` |
| `round3-main-pins.mjs` | `82f87e0ef3c2609cbfca31c2d53abbe8397055c2bfab60f7974fdf51b34caad2` |
| `round3-main-pins.log` | `315563d501f5a5626322f6a61113ef6776fd85b77880559711e6c9516b39759d` |
| `round3-main-current.json` | `883c5088c39321f42738631e564a103113e3043e68d315a24d753e509d505f66` |
| `round3-counterfactual.mjs` | `64532d261eb3771841919238f0579e62a02bf4180bc71f077ea4ca545ef5b871` |
| `round3-counterfactual.log` | `49402d1b119b64e679b146e6cd1b1bb37669d081dd82bff8e45a38efc027ce3c` |
| `round3-counterfactual-source.json` | `1aa6e7abdf7a6242c79618d2b60ffe3489e8de0dc01c1b90fa24f88501e106aa` |
| `round3-run-measurements.mjs` | `0362720d316ddbce308dedb2e1c71d4360c0cfea96741dfe2db987df51c4391f` |
| `round3-measurement-driver.log` | `ab19fb18bb56cd5740c61c34332f3811acadaea35ffb2471a1a322484c5da38f` |
| `round3-phase-summary.json` | `aee19625c7869a5f234d509e2d39737f5043dc2005a9e450b1c73262e26d4d39` |
| `round3-entry-maxima.json` | `1c75f88a7493f09cc6270c8df2edc0015fa5c1f280e95113c7ae27adc6a23cec` |
| `round3-summarize.mjs` | `39113ecea1c4f8fffbf93873c2666f578988fa73785d5c7fcd5f2b407380b4f1` |
| `round3-membership-measure.mjs` | `8b9df37fc22a0a7eca5f6626922569867d87491d1c75da4337db59ad5301ee12` |
| `round3-final-after.log` | `d3dbade99be9d7ce48830796330c8f10de066d8f509bdad38548810933e9585a` |
| `round3-final-after-live.log` | `d85408656926bd74466ee3f94a217418fc794dce36a0b43d5c1f6bd6bbd2b689` |
| `round3-final-git.log` | `32ce587b87186fe3da6e7c5989f1acd4ebef36295277500d254b8c352fa26995` |
| `round3-final-git-live.log` | `b3af22fbcaf009209cb12db97db4c02b84ccb058e9dde609853f252c6786e406` |
| `round3-final-pool.log` | `ea3218f170c16eaa4eae2ed7ba0ae8fca044433c57f87b51ccd846ea057338a6` |
| `round3-final-pool-live.log` | `b2ad2aa7f9564121d7c21229b550255b796d5cdcbc61e734769eaa4cef5621fc` |
| `round3-final-checkout.log` | `d67297c84a84151d46962db1cd5607b8d7610cad82b88149c154393c19267519` |
| `round3-final-checkout-live.log` | `6c9c6c7c47d82f70bf1f05cc2cd2f8db29b95c0c58e3f424a6c23f29f49aea2d` |
| `round3-final-metadata.log` | `fc6379e718e487079cf02f3da365de66dbfb5e01f3bf64fd1f8d6ad649e83e6c` |
| `round3-final-membership.log` | `fd755c530ac289f67057863987ffa9005780aa0cd85e1816625a687be7b70bde` |
| `round3-main-stage-rbcwpx/main-source.json` | `7dbc6cfd4307358f3187e84b9995077b860d1c329d0415b60c4e211abc504f32` |
| `round3-counterfactual-stage-LY2LOQ/source-manifest.json` | `a5fc5f0a7ef17ecd185c8b1a24745f0f2fdf08a1f1d36a694258212e18a04621` |

## Raw evidence

All task-local filenames below are under
`/home/akisarou/.cache/nts-scratch/1013/`. SHA-256 binds the exact file.

| File | SHA-256 |
| --- | --- |
| `before.log` | `cd86e9eff3bc30088ed5ce91549812b2f633add12b1b043e572a5c2e56193dd2` |
| `after-complete.log` | `19e8dc5b8c30dea981c3bef1b9eaa95f7aa412fb5a69fc3076bf48c30c0ae256` |
| `after-live-complete.log` | `b57881eb7c409778c6c2e2911ab78352ea9f09e9b3cd7b611f90a2881ba1b5c6` |
| `git-measure.log` | `c30afd7d7e6e98aac932261294738d4ff5d984847c214235e45516abc484e94d` |
| `git-live.log` | `4584ffa86fabad07e7f45ee8c6c7e57502a18a98b487886af4c45d58346f5049` |
| `measure-before.mjs` | `ac28537a69b2ba9ca6ba7784faebd102daa22a158d81b0b263f9d1be3ec7cd1e` |
| `measure-after-complete.mjs` | `66b47bd28214088ea1174b7cf9bf0be688ad808c19f8dc8a4839ce5f9704142e` |
| `measure-after-live-complete.mjs` | `2ce97e79496e9b7643a85269129e0af9d7b934425b0ce21d9e95241d9c2389ef` |
| `measure-git.mjs` | `a721436d0df238508b034e24970a04d4fe0068d548262b26e43375bde9b940d7` |
| `measure-git-live.mjs` | `3291b1916336a48b7c2649e59aaa06d1d986fd7c465ffcfb0c32952bcb21ecc1` |
| `stage-git-before.mjs` | `254f4a909117b1c7761e5d21eaf06efebecd017394ef8f6564719784c23276d5` |
| `focused-full.log` | `b38c630dd8bf44c9e7e01b9b166e4510353bdc277bca257d48b1030acb8a7bd0` |
| `integration-retry.log` | `e95951117fc34a99444218fcdc2aebac91ba32c6145d6a12687b07d7545c54a5` |
| `setup-types2.log` | `e87facbcf2742f42e438ab03a2f40c1bf310026820cab1a4a35eff7b29b7c20c` |
| `inner.log` | `1c90f0501cd240460514065d134a1f39b28efe51caebd12b8d342a6f04ceef35` |
| `main-cli.log` | `11e9634372a46f263eeb8a0272ca577f6738bb74a45498463b1e5e00bb609863` |
| `reproduce-main-cli.mjs` | `c79450d1deb4170cf57370baebe4d2bed8b592dc111022589aa6fcf9b41f5bfd` |
| `pool-measure.log` | `f15e1d2f09cf887fc050a2c901e2ace00895e7047fff195de5db39afa1b10021` |
| `pool-live.log` | `da6bd86ff7aae1afaf7d2e695b1406eef567beeb23539a279490f80c2e7cff19` |
| `measure-pool.mjs` | `1abd0dbecaafe2a899ffef7cec96fa079cfa1f1bdf9442e2b2382413d7a9e5bb` |
| `measure-pool-live.mjs` | `0b00b83b85c7209a2d23bbf4fa03ca5dbdfcfc99e0a7f98178446210bfdff286` |
| `check-here.log` | `6d757077876fbf0e2f8f16da98060244557c8fe2abe2e0aca2cd1cc80a0816c9` |
| `final-after.log` | `933c7d0f13c10596cc71637382535c03552bb0c55de77dcd24266f9ba41ff433` |
| `final-after-live.log` | `877f8503f8c56474b17b962b1da52793547aac25fe74471a6d02b1ef94cfe649` |
| `final-git.log` | `711a9372b168f2868c3ecc42410acc4fe8a3b880be84ba843d3362795fff3c3f` |
| `final-git-live.log` | `81a67cd7044c45c177c2012e2e754cb3f22d1446e45cc3c44b70cc9ef1a998e9` |
| `final-pool.log` | `dc8ab4817a2ce1eeec2fa3146a8cc8401b2b0372e915b11dc3777911b5b1d98f` |
| `final-pool-live.log` | `6ce0f0506795add3f3a8b887b6024485ffa8ac61e2f1be95710f20bc3268a057` |
| `measure-git-after.mjs` | `1d6f6274d3d7081427432b5cb87084decb100bbed2c659c77f08df58f2b2681b` |
| `measure-pool-after.mjs` | `e6b1e04b88186f51206b7bb2046b6e6b28e26743d1f7c6e5366067248ce36c7f` |
| `run-final-after.mjs` | `dceac049c4f2501bd1e597832a88a9e7ecad99e32234aca13e038f7142608814` |
| `release-controls.log` | `94887d1db88a241fe7749785c3a6d6781890871c14ba0e11508ca79cff814324` |
| `release-controls2.log` | `c0f1968055e74a9b9a7f42fd6e8bdf16691f34c82b02e609d6b001375025f8e7` |
| `release-controls.mjs` | `fbb8731c3e975a4168aaac5e874b308b77a72eba12c168457a14622ffa256714` |

The incident file is
`/home/akisarou/.cache/nts-scratch/857/held-adb5d644-gate.log`, SHA-256
`97b3638de7e492d4feeb50c78e830a555dc4576e2880ecb333711b1aa853bf29`.

## Final atomic-detach and mixed-main raw evidence

All relative paths below are under `/home/akisarou/.cache/nts-scratch/1013/`.

| File | SHA-256 |
| --- | --- |
| `combined-controls4.log` | `7150ef7377ef73ae409f376ab555773e32252d22ead323bee96bbae49928622f` |
| `next-proof1.log` | `b9cf29c832a0a54b18f4561f433e43c4d5b27b5ea48f3ebcefff3735f0403439` |
| `next-proof2.log` | `0b64b93bd370238451448359ea5e6780c032a9c933d74fc851d91a7ff0d26c84` |
| `mixed-proof3.log` | `524bb2cf97d2ac86c3b1deb02cc79e7c439b996d82715090901be8802ce45d1a` |
| `mixed-main-controls3.mjs` | `419d4cf05f60289b42f616f63c0202b2c01351d49db3a8d8ecf2d178209e970f` |
| `mixed-main-controls3.log` | `754bca80341637e81a0e5146178a319858e587c80e3b3d8c7cbc38ccf00fb551` |
| `mixed-main-pins2.mjs` | `19497b0f531544562f4c1b84bc4f2c7a16f976ab4ac7a08fd9491a6879d5606b` |
| `mixed-main-pins2.log` | `3c49f2a2e9864989cecf0795ff433831df453c4047b20740c4ebaffb50089f49` |
| `mixed-main-current.json` | `22574b3aa6781b39322ec2cb1fbf0e591b721eb0e875751dbaf8a59eb47a5176` |
| `run-mixed-and-measure3.mjs` | `38819c484c7a88ab7ce1c242eb999457e0d9cff4af161f982f5317fae34065fb` |
| `run-atomic-final-after.mjs` | `0f0c379359fa445c705c441c0f5f84cc128339fbdfa768df883af34f7337ab86` |
| `atomic-phase-summary.json` | `a441d867186189f201a11b6c13a46a13312db9ff46dfdd17159803699adfb67b` |
| `inner-final.log` | `540b6eb2c7e0b7a01ba834ec98b1fdd8c79cee9e0cf425c428560c147a839383` |
| `run-inner-final.mjs` | `a6f3cf3823d7e7171beb4f87e5b3656d5eeef3681bf096fd48dbeeb37ecd8ed0` |
| `receipt-pin-final2.log` | `dd0f2bf5b9eb41fc8a5042870782966aad262dd44865e8af74718db84b48378c` |
| `receipt-pin-final2.mjs` | `b3d837c984b7e9cc6cd237f707b9c5fb1c48f18112b1f7c4f47760c59668c7b8` |
| `receipt-pin-final.log` | `16e636eee9f299776162b6c9bc90080502c46491de4fd456761f09db1bff8dff` |
| `mixed-main-controls1.log` | `016264c3b05d149f2f43b107855a50a301a3f08acb21465fc9668639af25f1b6` |
| `mixed-main-controls2.log` | `504d68e41b7b48c26924f505cdbb0c08b645d5ae21d06b4385f6e0206d56c162` |
| `mixed-main-controls.mjs` | `eaa09a92f8d3007e84f2077ef1eb6c75834f0cb9a86d5ca5cfe1d459c89c5ff5` |
| `mixed-main-controls2.mjs` | `6c325f29d54413efcb9426b70e9e7317e51648157130e5c49efb511685e3f161` |
| `atomic-final-after-live.log` | `d066d5d27a4caaacaf4c1d1c57a21306b083529d4c36890a99e381e9411a604c` |
| `atomic-final-after.log` | `35ae522c446653a470598858efcf260cf6c6bd2031314e553969f58845a3542a` |
| `atomic-final-checkout-live.log` | `b79edd891618e9192d45996532f0f1505ecee0f534950e131077403b3afa7c47` |
| `atomic-final-checkout.log` | `d34fe4bd2a688747300e5fbbcba4c432b47df29ff7ed7046de02974755bcbacd` |
| `atomic-final-driver1.log` | `7ead74ea035505ecdf500386965ce64482c9363ec1d0207f19f1920a7dca6f57` |
| `atomic-final-git-live.log` | `10391773967522f8aee79beca8fceda0fb4a5a4adf23b73892812c44158eaa6c` |
| `atomic-final-git.log` | `59284be902b702d1ac07fe39d8158e8a9506401377132740626cb1723919db6e` |
| `atomic-final-metadata.log` | `38db024a84b48b851beb3e96cb60fe6bfd9b261a1f16821f32ce138693da14db` |
| `atomic-final-pool-live.log` | `0c570ede2aab3e3a745f632cef4f7043e1def22e78d5a6b6a907b2d1b8b9a1a4` |
| `atomic-final-pool.log` | `e551aad368011d2d14fdad2723aa1f0379a59ae8550ceb80fca3c35aa87e1739` |
| `atomic-measure-after-complete.mjs` | `237bf2a2cdfad2e2b40a764d37a5a3524cb60b10dcdb3e690f7fc4446d388095` |
| `atomic-measure-after-live-complete.mjs` | `72d509d2ff51116d0bbf92e84c6d9d172d6d9110bda0ad2f7343658ca22df877` |
| `atomic-measure-checkout-live.mjs` | `c11083b37478d4d0e39c7b8ae43065f127e8b6c7867b820cfd30a59bc6c014a3` |
| `atomic-measure-checkout.mjs` | `861c26fce1eaaa1b385e8deff0afe81fe1d658cebbe131523cdc1eaca1f698fe` |
| `atomic-measure-git-after.mjs` | `976129ebd64daaf06268d859ea1c5189ee782640eeab9e5dae2af5a541acc4dd` |
| `atomic-measure-git-live.mjs` | `c388e22cb57708e75a8214ae94df6350e46b3c9f3a4b4374d025f45a824739ce` |
| `atomic-measure-metadata.mjs` | `de92f8dec4d7ff6268b8d52f8951b89a787a7b4ade59a6f45edb3f7f2259e242` |
| `atomic-measure-pool-after.mjs` | `8d11e4fe2420b86a2bda0d0e74abb9ea19fbb9a80fa727d9cd4af546439fd1ef` |
| `atomic-measure-pool-live.mjs` | `ff65f2564c39caef2182f7f9aaf3a945435728652c63392cdc5b48c511c88435` |
| `mixed-main-stage-WfXUqV/main-source.json` | `77f14a870f8ac39b2a122233b85f6e62cfa3cb0af43da4fc149f733d16ac537d` |
