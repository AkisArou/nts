# Sealed Node harness runtime — #783

Base `077ebae9a22aacf5ba447bfb4a28f287faab6a46`; proof source `26d4a3b674d650357a07e0e64d5cad2de5d9de0a`, rebased onto landed `8fdadc8816fe8a5908ffdc181c39525f80c641b8` with identical oracle and conformance source bytes. Raw machine evidence remains at `/home/akisarou/.cache/nts-scratch/783/sealed-node-harness-783-raw.json`; SHA-256 `1b8364a7a85d0e30b801e9428dcce661c870e008f45b74d5c4d4d4b2f48929d6`. It authenticates 2,092 selected artifacts (59,931,840 bytes) and 154 Git source receipts, including authenticated absences. The scratch retention row keeps this referenced evidence.

`oracle-node-harness.ts` is the single sealed execution owner for the previous helper and path functions. The prepared loader exports it; the direct route uses the same source through Node stripping. `run-one` alone selects that route, consumes its private capability before imports and binds the fixture module once. Infrastructure uses the strip-only planner path; programs keep their actual compiler projects. Native source validation and materialization compose preparation-only assets with the single execution inventory.

The complete program population is byte-identical: 1,724 answers (1,487 calls and 237 observations), 12,471,185 bytes, SHA256 `62e418f20150bcc9b042cd9e272d6fa0fac55c2030796bdc46e646b1bfea915f`. The complete TypeScript population is byte-identical: 12,189 answers, 2,566,943 bytes, SHA256 `da28987a03f1bedd030d17c6d1675b394a0934372a6f9a224a82fd2224e75621`. These prove the general seal, rather than execution of the Node harness. All JS/TS bytes are unchanged between this corpus proof and final source; native materialization has independent corrected proof.

| General corpus | Answers | Bytes | SHA-256 |
|---|---:|---:|---|
| Programs | 1,724 | 12,471,185 | `62e418f20150bcc9b042cd9e272d6fa0fac55c2030796bdc46e646b1bfea915f` |
| TypeScript | 12,189 | 2,566,943 | `da28987a03f1bedd030d17c6d1675b394a0934372a6f9a224a82fd2224e75621` |

The direct Node sample runs sixty real flag-free local cases across 27 module directories, including fixture and non-fixture source users. Both arms report 53 pass and the same 7 existing failures. Every row and failure message is equal after exactly one authorized provenance substitution: each arm's absolute checkout root becomes `<root>`. No other text is normalized; all raw rows and streams remain. The real tooling controls separately execute prepared run-one with stripping disabled, refuse unrelated unprepared TS and changed infrastructure, and compare direct/generated helper behavior. The new helper is explicitly included in strict tooling checking with zero diagnostics.

| Node evidence | Cases | Pass | Existing fail | Decision |
|---|---:|---:|---:|---|
| Direct run-one sample | 60 | 53 | 7 | Exact equality after the single authorized checkout-root substitution |
| Full prepared population | 0 | — | — | Identical pre-existing preparation refusal; #785 |

The full prepared Node population has executed zero cases on both arms: its first `assert` member refuses with byte-equal null-byte path diagnostics under the immutable Node test/addons subtree. Every source-derived module plan captures that shared subtree, so module selection cannot exclude it. This pre-existing ungated-area defect is [#785](https://github.com/AkisArou/nts/issues/785), separate from the held gating work in [#739](https://github.com/AkisArou/nts/issues/739). No successful full prepared population or gating change is claimed here.

The unprivileged ABBA samples use sixty program cases, sixty TypeScript cases and the same sixty direct Node cases. The program sample has thirty entry sources importing Node functionality and thirty others. All sampled answers agree across four arms. CPU is retained StepScope accounting-root usage_usec, including its systemd SDK worker scopes. Peak is the fresh scope memory.peak after drain. Canonical dependency capture and run resolution-session setup precede the measured producer interval and are timed separately; this is no whole-core cost claim. CPU and wall were observed under concurrent load.

| Sample | A mean CPU s | B mean CPU s | A spread s | B spread s | B/A |
|---|---:|---:|---:|---:|---:|
| program | 11.342952 | 10.150999 | 2.709853 | 0.251226 | 0.895x |
| typescript | 5.072729 | 4.512610 | 1.385999 | 0.090395 | 0.890x |
| node | 13.889433 | 13.008425 | 1.902126 | 0.105511 | 0.937x |

B stays at or below A within A's own spread: no measured CPU regression and no speed claim. Per-arm CPU, peak, wall, source bindings and raw answer hashes remain in the kept raw evidence. The earlier full-program wall difference is accepted as load on this sampled evidence. Full-population per-step CPU comparison remains an after-landing core observation.

Corrected supported `here-26d4a3b674d6-1794663749493` is canonical with experiments [], 19 PASS gate summary steps plus its builder (20 CLI checks), cleanup and diagnostics complete. Gate wall is 381.245 s; the landing owner prints 385 s and the actual CLI takes 397.476 s. Native is 3,047/0/8 ignored; tooling is 2,330/0/2 TODO. Actual inner is green: fmt 3 s, Clippy 2 s, build 3 s, tests 409 s. All 211 focused controls and ownership/timing/strict audits pass. The landing defers both full oracle productions; its route fits the ten-minute bound. Cold full capture belongs to the next full-check core, and proof captures are separate stores, never labelled warm landing results.

One counter wiring attempt used sudo without authorization, violating the standing rule. Its receipt is explicitly **inadmissible**, retained separately; no privileged metric supports acceptance. Only unprivileged CPU frames support the cost table. The reboot-interrupted V1, failed setup invocations, original native/tooling RED, assertion-format RED, prepared-population refusal and raw-root comparison remain separate. Source repair never weakens loader authority, source identity or the Node corpus. The unchanged baseline pool lease has been returned. No additional full proof is implied by this evidence-only record.
