# Benchmark rows retain build CPU

[#794](https://github.com/AkisArou/nts/issues/794) adds optional version-1 build details to successful and failed benchmark rows. External compiler, assembler, javac and link stages retain exact `wait4` user/system CPU from the existing waited-child adapter. `activeCommand` remains the only CPU/inactivity supervisor. Tool output and versioned usage receipts are separate, and every row receives an explicit recorder. Old immutable runs decode without the new field.

Sequential nts capture, preparation and emission phases retain `RUSAGE_THREAD` CPU for the caller. Their basis explicitly excludes shared checker processes and worker CPU; these partial values are not presented as total row compile CPU. Ordinary failed builds keep their observed usage. A bound kill may prevent a final waited receipt: the unavailable reason and the supervisor’s last own-CPU observation are then separate, labelled “sampled at bound” rather than exact final usage. Missing or malformed mandatory observations refuse instead of inventing zero CPU.

| Accounting and compatibility control | Actual result |
| --- | --- |
| Native row recorder | Successful and failing child usage, calling-thread CPU and failed thread phase retained |
| Fast child, nonzero exit and malformed/missing usage | Existing status/output preserved; malformed observations refuse |
| Supplied bound sample and blocked owned command | Explicit unavailable final usage plus separate sampled-at-bound CPU |
| Producer, journal recovery and canonical decoder | Optional details retained on success/failure; unknown column refused |
| Existing record rendering and verdicts | Historical schema and throughput decisions preserved |

The executable comparison uses authenticated fib objects and the retained real `ld` operands from the earlier link-owner control. Copies of those exact object bytes and one fresh exclusive output path feed old main’s case-bound and the new metered `--build` route. It compares complete ELF bytes without stripping.

| Executable arm | Bytes | Full ELF SHA-256 |
| --- | --- | --- |
| before | 26432 | b44c0210b63a57ce61ba9fc9b6d18a79c0eb3b1c43c4f6be214e3d02bd21fd15 |
| after | 26432 | b44c0210b63a57ce61ba9fc9b6d18a79c0eb3b1c43c4f6be214e3d02bd21fd15 |

Both ELF bodies are byte-identical, including the earlier authenticated fib hash. The new link receipt reports 0.077146 user CPU s plus 0.019778 system CPU s, status 0 and no unavailable reason. This proves launch/accounting parity for the retained link operands, not a speed claim or a comparison of fresh compiler output.

The record arm is a same-observation replay of the real fib row from `2026-10-23-1d91ace6da2b-full-table`. A one-row projection is marked incomplete and passed through the old and new record owners. All twelve cells (nine OK and three NOT_PROVIDED) and all verdicts are byte-identical. Removing only `rows[0].builds` makes the complete canonical records equal. The sole addition is a version-1 external `nts C` / `ThinLTO link replay` receipt from the executable arm; it is not attributed to the historical run’s original build. The old/new bodies and explicit optional-field diff remain in scratch. No benchmark sitting, new measured cell or `results/` write was performed.

| Final proof | Actual result |
| --- | --- |
| Supervisor/record consumer population | 64/65, sole fixture API error corrected; affected repeat 1/1 green |
| Final expanded record control and timing/host/strict audits | 1/1 and all audits green at 02603559be2d |
| Required inner V4 | Status 0; fmt 3 s, Clippy 1 s, build 3 s, tests 297 s, frontend 30 s |
| Supported landing route | 19 summary rows PASS; canonical, no experiments; cleanup and diagnostics complete |

Focused V1 stopped at new fixture strict diagnostics before tests; V2 then stopped at two unclassified supplied/blocked timing controls. Corrected fixture types and precise timing classifications retain the existing audits and policies. Focused V3 passed 64 of 65 controls. Its sole RED was the new renderer fixture passing a record instead of an array. V4 repeated that corrected control successfully; V5 repeated the expanded unknown-column control and all audits at the final proof pin. Before native proof, source review restored run_driver’s root parameter used by javac. Inner V1 then caught a JVM program value scoped inside the new thread measurement; V2 caught precision/size/argument/test lint diagnostics; V3 caught the borrowed NativeBuild plan’s missing Copy derivation. Those failed runs are retained and excluded. Inner V4 is the complete actual green native proof.

Raw evidence: /home/akisarou/.cache/nts-scratch/794/raw-evidence-v1.json, SHA-256 c269fed656d919d7780e715d827d5bd6a1503740e3a0193e9d4c3bacb7a79edf. The finite manifest binds selected logs, old/new replay bodies, exact object/ELF bytes, usage, launchers and Git source receipts; regenerable temporary and build trees are excluded. Proof source: 02603559be2d76a5222cbdf356d69c8b6c91b493.
