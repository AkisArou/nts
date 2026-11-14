# Bounded selector preflight — #773

Range selection evaluates immutable endpoint rules before the landing service
starts step clocks. Its synchronous Git and Node endpoint calls previously had
no local bound. They now use the existing infrastructure probe owner, including
historical self-tests and content precision queries. Expected nonzero answers
retain their classified statuses; a failed observation becomes named INSTRUMENT
and grants no selection scope. Missing content keeps conservative fallback.

Base `e4f8d9a9bb70558b8bd7a681d7a66cc2751a3fa5`; component `82d4e261a707c948638fb8a0be17c00d66b62979`;
canonical/inner source `170d280ba4d8906cfaca311288e377a0f9082ab5`. The [companion](selector-preflight-bound-773.json)
authenticates source receipts and retained proof artifacts.

The actual readiness-held endpoint control returned status 75 with the named
300,000 ms wedged-probe diagnostic after 300.130 s.
The exact endpoint was gone. The old parent selector was still waiting before
release, then completed normally with status 0. Both arms removed their private
pins and range directories. This substitutes only the parent owner against
fixed current dependencies. It closes a present unbounded wait; the earlier
concurrent selector hang's exact operation remains unknown.

Focused controls pass 48/48; timing, host and strict
checks pass. Exact full/unplaced/policy arrays remain 178/142/36, equal to the
baseline. Canonical run `here-170d280ba4d8-1794631676426` has 16 PASS steps,
canonical environment, no experiments, and complete scope cleanup/diagnostics.
Tooling: 2351 passed, 0 failed, 2 TODOs.
Native: 3047 passed, 0 failed, 8 ignored
across 55 binaries and 18 doctest crates.
Actual `inner.ts --no-agree`: fmt 4 s, Clippy 1 s,
build 0 s, tests 298 s, all PASS.
Runner wall 704.122 s and CLI wall 716 s
are distinct; summed admission wait 697.533 s can overlap execution.

The initial timing-audit refusal and unsuccessful documentation patch setup
remain distinct from accepted proof. Only the owned obsolete debug profile was
removed before the canonical run; its apparent size and free-space endpoints
are retained without claiming exclusive causation for a concurrent free-space
change. There is no deliberate load or performance claim.

The coordinator accepted this wiring plus canonical/inner proof for landing.
Two loaded preflight replays on landed main and #756's loaded-main confirmation
remain pending until today's benchmarks settle and no landing is active. Their
confirmation must retain the historical-cause limit.

The companion authenticates 206 artifacts (6,048,120 bytes)
and 20 source receipts. Existing report-serialization evidence is
separate; no additional transport or historical Git attribution is made.
