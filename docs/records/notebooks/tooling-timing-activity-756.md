# Tooling timing and activity: #756

Frozen proof 489dd582a1f9a8047c3616864aca380636ec4e26 separates supplied timing from native activity acquisition. The base is e1e3d6dc5d6c99f564d473a8b48a5287973cb217.
The [companion](tooling-timing-activity-756.json) authenticates 411 artifacts (230,450,183 bytes) and 36 Git source receipts.

## Behavior

Timing supplies now and scheduleIdle. Activity independently acquires its frequency, watch, sample, verify and close lifetime. Supplying timing preserves native spawn identity acquisition and terminal verification. Timer renewal, entry completion and final drain clear each closer before invocation, attempt all owned releases and retain cleanup errors. A completed assertion remains FAIL beside observation verification or cleanup errors. Missing identity without a completed failure remains a named INSTRUMENT.

The missing-identity fixture waits for subject readiness, advances supplied time to 300,001 ms and delivers only the idle callback. Pass and fail finish without timer delivery; timer and watcher closure are asserted. No production clock source is rewritten. A native positive proves its real spawn subscription exists while running and disappears afterward. Twelve actual child arms exercise pass/fail with verification, lifetime close, watch release and combined timer/watch release faults.

## Accepted proof

The full affected batch passes 58/58. Timing checks 289 files/46 reviewed sites; host audit 1,914 sources/274 closures/418 reads; strict 855 modules/5,694 recorded diagnostics/no new diagnostic.
The supported run here-489dd582a1f9-1794647297904 is canonical with no experiments, all 16 summary steps PASS and complete cleanup/diagnostics. Tooling: 2353 pass/0 fail/2 existing TODO. Native: 3047 pass/0 fail/8 ignored. Actual inner --no-agree exits zero on that same frozen source. Exact formatting/Clippy/build/test logs are retained.
Runner wall 463.954 s and summed admission waits 277.015 s remain distinct.

Corrected loaded V2 executes the eight-test activity file three times through production runScopedTooling in the sealed canonical environment. All 24 tests pass; reports retain status 0/completedFailures 0/no experiments. The owned 32-worker/2 GiB load exits zero; cleanupErrors [] and terminal 2026-11-14T09:07:29.245Z retain full drain. This is component confirmation, with no performance or full loaded-main gate success claim.

## Retained failures and limits

The full-check run at dd79e exposed the control’s real 1,000 ms completion race. Its exact failure and source are retained; the coordinator marked it fixed forward. The first supplied implementation passed 3x7 under load but text replacement hid a capability composition gap. It is superseded, along with the added then removed timing row and host refusal. The first lifetime control incorrectly invoked node:test recursively; its RED is retained and the accepted control uses a real child. Peer review found immediate release callbacks outside aggregation; accepted source controls them directly. The private evidence-writer quoting failure and wrong optional interruption-field assumption occurred before publication and did not affect target proof. The corrected writer checks the retained SIGTERM child results.

The earlier full loaded window was stopped by its named unit. Its first replay completed product status zero, independently of the interrupted controller; replay two and full --here were not run. Two selector replays plus full loaded-main --here remain owed after this slice lands, without an active landing. Their actual result will be added to #756. The exact historical pending operation remains unknown.
