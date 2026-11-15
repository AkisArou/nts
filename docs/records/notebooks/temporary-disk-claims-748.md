# Temporary disk claims

Temporary captures previously checked free space without reserving it. Two callers could each pass the check against the same bytes above the disk floor. The shared DiskCapacity owner now checks and durably claims the requested allowance under its existing pool lock, after pressure reclamation. Pool, build and temporary admissions subtract the same live promises.

A separate versioned claim file records each claim's UUID, PID, birth identity, path and bytes. An acquired lease releases only its own claim, once. Dead or reused process identities confer no capacity ownership; unknown state versions refuse. Capture keeps the lease through preparation, image publication and resource drain. A release failure fails that call with the retained primary and cleanup causes; it does not mark a successfully published image failed, so the next call can reuse the valid image.

| Supplied control | Main before the fix | Fixed owner |
| --- | --- | --- |
| 41 GiB free, 40 GiB floor, two 1 GiB requests | Both admitted | First admitted, second refused |

The before arm loads exact admission/capacity module bytes from main `32934d573d80ccb816bae269e0dc9aa806e9349b` with fixed current dependencies. It is a component control with supplied disk observations, not real disk exhaustion. The capacity namespace assumes the configured outputs and capture temporaries share one filesystem. Full live claims also count bytes already written until release; that conservatively overcounts by at most each live capture's allowance.

| Validation | Result |
| --- | --- |
| Two real contenders using the same claim state | Exactly one admitted; the other succeeds after release |
| Child abandons its acquired claim | Next acquisition discards the dead claim |
| Release refuses after ready publication | This call fails with tooling-cleanup; the next reuses ready |
| Focused capacity, admission, host observations, capture and reclamation | 70/70, zero skips or cancellations |
| Timing lint, host audit, strict tooling check | Pass |
| Supported landing route | 18 summary steps PASS, canonical, no experiments; cleanup and diagnostics complete |
| Required inner route | Formatting, Clippy, fresh compiler and selected crate/backend tests passed; actual terminal status 0 |

Proof source: `cb097f619b957dfd602d9d04be21fca8c94623ba`. Raw evidence is retained at `/home/akisarou/.cache/nts-scratch/748/raw-evidence-v1.json`, SHA-256 `18b1e80939f2d2dc9b3b117c3afe4c6582f58c1f00faaaba0f0733122b5790c0`. The manifest authenticates the named results, logs, control drivers and Git source receipts. Prepared V1 launchers were never run; only the actual V2 focused chain and the completed integration chain support this record.
