# Completed wide runs answer the night

A wide run of the current verified commit answers the nightly slot when it starts at or after the slot, whatever its verdict, or when it ends at or after the slot with green or red. The controller records the actual measurement end separately as ended_at; at remains the start and owns the minimum gap. Missing or invalid end facts use the start alone. Moved verified retains its existing scheduling path.

The production-module comparison uses exact old main bbeb7476c8a859df7208b8a8b69dfdebab319531 and proof 590fd2284109f35585d4d84b833aef632e34d6d4 with identical supplied UTC dates, commit and outcome metadata. Its straddling example starts at 02:48 and ends at 03:29 across the 03:00 slot. This is a component control, not a measured census or live-controller run.

| Supplied case | Old main (bbeb7476) | Current |
| --- | --- | --- |
| Green straddling the slot | Nightly attempt due | Night answered |
| Red straddling the slot | Nightly attempt due | Night answered |
| Held straddling the slot | Nightly attempt due | Nightly attempt due |
| Held starting after the slot | Night answered | Night answered |
| Legacy post-slot record without end | Night answered | Night answered |
| Moved verified | Existing advanced path; minimum gap | Existing advanced path; minimum gap |

The controller fixtures use private repositories and stand-in units, advance a supplied clock at fake-gate return and read persisted state. The green straddler starts benchmarks after one wide run. The held straddler remains due once; its held post-slot rerun answers by start, and the third identical-time cycle starts benchmarks with the wide count still exactly two. This prevents an unchanged deterministic hold from causing back-to-back wide work. End capture precedes record publication. Benchmark ownership, admission and the held core retry remain unchanged.

| Validation | Result |
| --- | --- |
| Schedule, controller, state, queue and unit tests | 114/114; zero failures, skips, cancellations or TODO |
| Timing lint, host audit, strict tooling | Pass |
| Supported landing route | 16 summary steps PASS, canonical, experiments empty, cleanup and diagnostics complete |
| Required inner route | Actual terminal status 0; formatting, Clippy, fresh compiler and selected crate/backend tests passed |

The initial end-only proposal was corrected during source review before any test or proof ran. No result from that proposal supports acceptance. Proof used private controller state and did not restart the live service. No benchmark row changed.

Raw evidence is retained at /home/akisarou/.cache/nts-scratch/791/raw-evidence-v1.json, SHA-256 67ff9268ebc7b69a7d554c217eade89708f7719140f25af46c065a065b47a639. Its finite manifest authenticates selected scripts, supplied-case results, focused and supported/inner logs and Git source receipts. Proof source: 590fd2284109f35585d4d84b833aef632e34d6d4.
