# Owner lock publication and reclamation

Issue: #762. Base: `93037a9748462b1e5fc0fbdbc1c1e543a120955f`.
Node: 26.13.0. Date: 2026-11-12.

The refusal of #728's census tool was a lock defect, rather than a disk
capacity equation or branch-visibility defect. `Pool.take` already holds the
capacity lock over both snapshots and its branch switch. Its three concurrent
cold takes all returned zero with room for only two.

The original owner creates the public file with wx and writes its identity
afterward. A contender between those operations reads an empty string, treats
it as dead, unlinks it and publishes another owner. The original writer then
continues on the unlinked inode and also enters its critical section.

The named unit `nts-agent-762-lock-replay.service` reproduced that exact window
once, using an explicit pipe barrier. A second private variant first wrote
the complete owner beside the target and linked it into place. That variant
still admitted two owners when A paused after reading a dead owner, B removed
it and published a live replacement, and A resumed its stale unlink.

| Before replay | First entered | Second entered |
| --- | --- | --- |
| wx publication, paused before writing owner | true | true |
| link publication alone, paused after dead-owner read | true | true |

Both observations are 1/1 controlled replays, not load-dependent rates. The
only pause is in the staged private source, with pipe bytes determining its
order. The permanent controls in `tooling/landing/lock.test.ts` keep both
boundaries and exercise the five users' shared owner. A separate control holds
the reclamation flock after its helper exits. `pool.test.ts` pauses a take
after its admission decision but before its branch switch; the next taker
observes contention and cannot decide until the promise is visible.

The fix publishes a complete private owner through link, retaining the old
boot/PID/start format. Only dead-owner reclamation takes a sibling flock:
it rereads under that lock, then unlinks only the same still-dead identity.
The sibling inode is not unlinked. Normal holders retain no open descriptor
across their work. Empty, malformed and invalid-UTF-8 owners are preserved and
refused by path and exact bytes. Releasing twice cannot remove a later lock
acquired by the same process.

The same short flock collects unpublished candidates left by a killed
publisher. The embedded PID protects a live writer; PID reuse delays
collection. Acquisition checks candidates even without a public owner, so a
crash before link cannot leave a permanent orphan. Unrelated names are kept.

Before rollout the five users resolved to three distinct machine paths.
`~/.cache/nts-landing/serve.lock` (service, queue, check) held a valid 55-byte
identity; `~/.cache/nts-pool/.lock` (capacity) and
`~/.cache/nts/node-compile-cache/retention.lock` were absent. Nothing was
removed. The service control publishes the old format with the old writer,
confirms the new reader leaves it intact and declines entry, then checks its
release and the self-restart handoff to the next drain.

The committed six publication/stale-observation controls were replayed in one
private source copy, changing only `lock.ts` between the base above and the
fix. The base failed all six; the fix passed all six. The archive had its own
Git directory and disabled global/system configuration, and was removed after
the run. Logs: `~/.cache/nts-scratch/762/before.log` and `after.log`;
unit: `nts-agent-762-matched-proof.service`.

The final proof including candidate cleanup passed 188 tests: owner barriers,
pool/queue/service/check controls, cache retention, capacity, probe, owed,
selection and timing. Host audit and strict tooling checking also passed with
no new diagnostics (`nts-agent-762-orphan-proof.service`).
