# Supplied timing controls — partial #756

Source proof pin: `d064d7e8fbaffc40f77074cfdad22a633ec73458`. This is **Part of #756**. #756 and #773 remain open. The timer/scheduler, bounded-entry and native acquisition changes are independently proved; the concurrent selector hold is not fixed.

## Result

| Route | Tooling | Native | Verdict |
| --- | --- | --- | --- |
| Normal supported `check.ts --here` | 2242 pass, 0 fail, 2 existing TODOs | 3045 pass, 0 fail, 8 ignored | green |
| Deliberate CPU/memory load, same supported route | 2233 pass, 1 held file, 2 existing TODOs | 3045 pass, 0 fail, 8 ignored | incomplete: #773 |

The actual documented `node tooling/gate/inner.ts --no-agree` route passed formatting, Clippy, build and tests. Focused batches passed 167/167, 22/22. Host audit and strict logs are retained with digests.

## Changes and deterministic decisions

- Networking uses the existing scheduler as an injected dependency. Default instances own their scheduler; borrowed schedulers remain owned by their caller. Captured scheduled tasks decide timer fire, cancellation and stalled-handshake timeout. Real TCP/TLS controls wait for accepted sockets and completion under a minutes-scale instrument guard. Client cancellation precedes peer join and cleanup preserves the original failure.
- Bounded entry retains real launch, readiness and result wiring, with a shared hang guard. Existing supplied CommandLiveness sequences decide startup and inactivity outcomes. The fixture joins closeMemoryRun before removing its namespace.
- The native addon driver validates both addons before creating Workers. Its supplied-module control proves the old driver acquires two Workers before refusal, while the new driver acquires none; the valid arm still acquires both and retains its checksum. This does not establish the missing historical signal cause. Native guards distinguish timeout/KILL from genuine SIGSEGV/SIGABRT outcomes.

## Historical attribution and remaining work

| Named test | Actual attribution / control | State |
| --- | --- | --- |
| program consumers read completed answers from an nts-dev planner after the SDK workers drain | Sampler Worker inherited --input-type; not a wall-time failure Fixed by `e41c6b75894e19be8661aa5446f3f48fa828dddc`. | Named existing cause fix; current loaded transcript passes its control |
| a --here run at the agent priority yields its unused reservation to a service run on one ledger | Same sampler Worker execution flags Fixed by `e41c6b75894e19be8661aa5446f3f48fa828dddc`. | Named existing cause fix; current loaded transcript passes its control |
| landing/run-steps.test.ts whole file | Late sampler reporter appended build.log after fixture teardown Fixed by `899c68e7fb43de44e767aa529ce1b3b2faddaee4`. | Named existing cause fix; current loaded transcript passes its control |
| pinned binary identities survive a step relinking the original target / candidate pinned Node | Gate capability spawnSync ETIMEDOUT at former 10-second probe bound Fixed by `227ab51794c9da00429f210752cc4b3fb9789dc3`. | Named existing cause fix; current loaded transcript passes its control |
| integrity measures a CPU-active listing beyond its inactivity guard | Real 300 ms inactivity samples under load Fixed by `e20b881be19eb87c8a30615d7ce52aeb3b17a66b`. | Named existing cause fix; current loaded transcript passes its control |
| integrity records a project's own listing time, not when it finished | Real heavy/light wall-time ordering Fixed by `c389d823db0cf055b9e83eae3c00bfeb60687c28`. | Named existing cause fix; current loaded transcript passes its control |
| landing service tests | Pool fixture read actual free disk; not a timing failure Fixed by `4efa6376d63ef2f4610b01f98ba1dd66a110fbfc`. | Named existing cause fix; current loaded transcript passes its control |
| concurrent range preflights collect the same stale pin and only their own trees | Five-minute file guard expired with this case in flight; no root cause established | OPEN: reproduced in full loaded tooling; root cause unestablished |
| private_uv_symbols_and_host_loops_work_across_addons_and_workers | Mutant returned a signal; historical signal itself is not recorded. Old driver started Workers before native ownership validation. | Acquisition boundary proved old/new; historical signal attribution remains unknown |
| bounded active/compile entry preserves result | Real 50 ms execution inactivity control also classified a completed exit as hung | Supplied liveness decisions plus real readiness/result wiring pass normal and loaded |
| JVM TLS successful/private-root and certificate failures | Real 2000 ms connection/handshake deadlines and 5-second future guards | Supplied scheduler decisions and real TLS wiring pass normal and loaded native suites |

The original report classified several failures as timing based on elapsed wall time. The retained raw logs instead identify inherited sampler execution flags, a late reporter, a short capability probe and real disk observations. Those causes and fixes are recorded individually. The exact JVM before log shows the trusted TLS connect throwing SocketTimeoutException under its former 2,000 ms bound. The current normal and loaded native suites pass.

## Loaded cohort and #773

The named controller started 32 CPU Workers after they page-touched 2147483648 bytes. The load stayed active through the supported run, then exited normally ({'code': 0, 'signal': None}); no interrupted flag exists. Its initial, readiness and end load observations are retained in JSON. The controller checked landing status before and during batches; neither this cohort nor the later canonical replay ran beside an active landing check.

The broad loaded tooling step reached the concurrent range-preflight case and expired its 300,000 ms inactivity guard with zero earlier assertion failures. Both complete gate summaries retain scope_cleanup complete; the loaded run is red/incomplete rather than a green proof. The listed passing controls were actually reported before that hold. Ten isolated traced repetitions passed, with all four endpoint imports and both child completions each time. A later canonical-context, loaded full-file replay passed all 18 tests. Those observations narrow #773 but do not identify its cause.

Normal gate wall: 515.713 s; recorded ledger wait: 303.152 s. Loaded gate wall: 1515.321 s; recorded ledger wait: 738.779 s. Waits may overlap work. These are configuration-labelled observations, not a performance comparison.

## Evidence and reproduction

The adjacent JSON contains each raw artifact path, byte size and SHA-256, exact gate run directories, old/new driver control, named fix mapping, load controller observations and passing loaded test lines. /home/akisarou/.cache/nts-scratch/756/write-record.py wrote both records from retained logs. Re-run it before adding the evidence-only commit while HEAD still names the source proof pin. The keep.json entry retains nts-scratch/756 through coordinator review. Private source copies and their Git metadata are absent.
