# Product projects share the strict diagnostic ratchet (#719)

The existing tooling-types gate step now checks every registered product project
under its own declarations and diagnostic limits. A pure project registry supplies
input declarations and pending discovery, a format leaf owns version-2 rows, and
tooling-types remains the only checker and writer. A file checked in two contexts
has two independent project/module limits. Product implementation bytes are unchanged.

| Project | Checked population and context | Publication in this change |
| --- | --- | --- |
| tooling/tsconfig.json | Existing strict tooling and checked-JS options | Migrated tooling row |
| runtime/node/tsconfig.bindings.json | Strict allowJs/checkJs over every literal bindings.node.mjs basename | Pending |
| runtime/web-platform/test/wpt/tsconfig.json | Existing declarations and full local TS subtree | Pending |
| tooling/conformance/ecmascript/icu-compiled/tsconfig.c.json | C platform declarations, fixtures and provider subtree | Pending |
| tooling/conformance/ecmascript/icu-compiled/tsconfig.jvm.json | JVM declarations, fixtures and provider subtree | Pending |
| compiler/codegen/jvm/tsconfig.json | Remaining JVM forwarding entry | Pending |

Every project descriptor explicitly has the type-check role. The former JVM
member-grammar file no longer exists; the forwarding entry is checked without
resurrecting it. Root, config and global failures refuse, including for pending
projects. Independent family populations and Program membership checks retain
zero-diagnostic files and detect dropped projects, missing members and disabled JS
checking. New projects follow the ordinary pending-record rule: the first green
post-landing core records cycle writes their measured counts. This change does
not publish product diagnostic baselines or fix product behavior.

The completeness guard found five previously uncovered files:
runtime/web-platform/test/wpt/server/cli.ts, the C provider's calendar.ts and
string-case.ts, and the JVM provider's calendar.ts and string-case.ts.
Configuration-only include expansions put each file in its actual platform
Program. Their diagnostics remain pending with their projects.

## Tool-written migration and transport

The tool migrated the established tooling counts to version 2 with a full module
inventory and source key, enforcing every previous count. The submitted parser
supports version 2 only. Its transient version-1 migration read was removed;
ordinary --record updates established rows and refuses increases, while the
normal --record-pending mode writes absent projects after landing.

| Tooling module | Original floor | First migration | Final combined source |
| --- | ---: | ---: | ---: |
| tooling/bench/run-record.ts | 23 | 21 | 21 |
| tooling/records/summary.test.ts | 24 | 4 | 4 |
| tooling/census/suites/typescript.ts | 2 | 2 | 1 |
| tooling/gate/canonical-environment.test.ts | 1 | 1 | 0 |
| tooling/gate/owed.mjs | 193 | 193 | 191 |
| tooling/gate/tests.mjs | 6 | 6 | 5 |
| tooling/records/record-pending.ts | 2 | 2 | 0 |
| tooling/gate/run.mjs | 224 | 224 | 221 |
| Total, all modules | 5,694 | 5,672 | 5,662 |

No count rose. These are measured improvements in preceding source changes, not
product fixes in this task. The final ordinary writer checks 999 tooling modules
and 1,131 project/module memberships across six Programs. Only the tooling row
is published; five products remain pending. results/tooling-types/diagnostics.json
is outside the docs/records non-Markdown size ratchet.

A measurement's identity covers its actual compiler input reads, options,
population and checker recipe. Editing a binding changes its key and triggers a
fresh check against the existing limits; a stale delta cannot apply. Genuine
source deletion requires an owner-acquired lstat no-entry fact. A still-present
file omitted from its Program refuses. An errorful rename is a deletion plus a
new module, whose initial limit is zero, and refuses until its errors are fixed.

After [#803's family isolation](independent-record-families-803.md), type-checks
is one handler in the sole production table, immediately before rust-selector.
Its private-project controls import the generic core and only that handler.
This task does change the core contract: one additive audit root parameter lets
recordPending and applyDelta pass the transaction's actual source tree. The nine
existing handlers ignore it. Reading their audit bodies and helpers found no
module-relative source-root filesystem access requiring a follow-up.

## Boundary findings and retained proof

The initial projectConfig mapping on main treated compiler roots as runtime
imports. tooling's hand-run test-hpack-upstream.mjs imports generated hpack.js,
but the TypeScript Program resolves its source without that output. #761's
compiled-context owner supplies that boundary; this task duplicates no graph fix,
fabricates no output and adds no generatedProject for a script no gate step runs.

The truthful type-project edge later reached acorn through the installed tooling
Program when an outcomes fixture staged the full recorder. The same five leaves
passed on main 48dcdafc. Publishing the source catalog did not grant destination
authority to copy an installed-package Program: that deliberate copier boundary
stayed intact. #803 isolated family execution and staging instead. The deep
ancestor refusal that obscured a missing catalog is tracked by [#802](https://github.com/AkisArou/nts/issues/802),
not relaxed here.

| Final validation | Actual result |
| --- | --- |
| Focused checker, recorder, composition and summary controls | 57 passed, zero failures |
| Product input selector control | 1 passed |
| Strict, timing and host audits | All zero |
| Fresh inner at 0bd9439463 | fmt 4 s, Clippy 2 s, fresh build 1 s, tests 466 s; all passed |
| Supported native tests at de099076e1 | 3,078 passed, zero failed, eight existing ignored |
| Supported frontend execution | Seven files passed, zero unavailable |
| Supported ordinary tooling controls | 2,766 passed, zero failed, two existing TODOs |
| Completed landing owner after normal memory retry | All 20 selected rows PASS, contract present |

The #804 rebase skipped the obsolete generated selector commit rather than
merging its bytes. All 17 own source/config/test files remained byte-identical.
None of the ten subsequent changed paths appears in the 788 retained Cargo
dep-info files, and all 367 literal native embeds are byte-identical. The inner
remains bound to its original source; the final supported run exercises the
combined source. The post-rebase tooling writer accepted run.mjs 224 to 221 and
no increase. The selector writer then ran for 201.114 wall seconds. All 57 target
identities remain; the decoded role delta is exactly the added bindings config
and its directory, kind and lookup observations.

Earlier focused, migration and fixture refusals are retained separately. One
old proof launcher omitted the explicit resolver close/join and exited after its
assertions; a repeated launcher used the real command lifetime and joined its
helper. Post-#803 focused-v4 is the final focused result. No earlier setup-only,
interrupted or red result is presented as a final pass.

## First selector and supported-run data

Both final selection answers owe 20 steps including the compiler build, with 44
deferred. The estimate is 403 seconds on 24 slots. The base record is trusted and
current; the new candidate record has no accepted main blob and needs live
derivation (absent-live), with no catalog-stale fallback in this answer. This is
a data point for the deferred ALWAYS decision, not a retirement or speed claim.

| Supported measurement | Wall seconds | Result |
| --- | ---: | --- |
| Initial runner | 784.630 | 17 PASS; records and gate-inputs memory instruments |
| Normal retry of those two steps | 116.630 | Both PASS |
| Completed landing owner | 907.558 | 20 PASS including build; contract present |
| Supported CLI including selection and shutdown | 1,080.966 | Exit 1 from the sampler shutdown defect #806 |
| Successful records retry | 110.273 | Peak 3,658,309,632 bytes |
| Successful gate-inputs retry | 98.859 | Peak 3,370,729,472 bytes |
| Tooling step | 362.694 | Passed; derived ceiling 1,209 seconds |

The first records and gate-inputs attempts exceeded their learned 2.2 GiB runaway
bound, counted at 1.2 GiB, and were stopped with SIGTERM as memory-pressure
INSTRUMENT results. Their peaks were 2,397,278,208 and 2,394,632,192 bytes. The
normal retry ran only those steps and passed. Both attempts were canonical with
no experiments or interruption; scope cleanup and diagnostics completed. The
first failed temporary was retained and its registered image dropped; the green
retry temporary was removed. A measured admission wait overlapped the full
check and resolved normally. No cap, history, memory floor or bound was edited.

The CLI's exit 1 is not a first-summary verdict. Its final landing.json says
green with all 20 PASS and a contract. The retained stderr identifies
“landing-build sampler did not stop within 60000 ms”. The parent releases that
sampler and starts a blocking retry without joining it, then awaits its close
after publishing the green result. The 116-second retry exceeds the 60-second
drain guard and delays parent delivery of Worker exit events. Actual physical
Worker exit time was not recorded, so the receipts do not distinguish a wedged
worker from a delayed-exit-event false refusal. [#806](https://github.com/AkisArou/nts/issues/806)
owns joining before another synchronous attempt and recording that exit time.
The coordinator accepted the complete aggregate and retry as step proof, with
this external shutdown failure disclosed; the CLI itself is not called green.
The queued service still runs its ordinary check and retry.

## Sequential same-tree cost comparison

All four commands below ran sequentially in the same pool tree, first at main
f6a8a022e329 then at de099076e12b; the original branch was restored cleanly.
Each source's real linker published its catalog. External load-hook profiling
names actual project requests and Programs without modifying source files or
adding production seams. CPU is exact waited child rusage; peak is the existing
HostObservations per-descriptor kernel scope meter, reset before each command,
including wrapper and SDK descendants. These are loaded, instrumented runs,
not isolated speed comparisons.

| Source and command | Wall s | CPU s | Aggregate peak bytes | Programs built |
| --- | ---: | ---: | ---: | ---: |
| Main: records | 16.494 | 18.20 | 1,944,641,536 | 0 |
| Main: gate-inputs | 67.660 | 77.98 | 1,494,683,648 | 32 |
| #719: records | 193.026 | 255.37 | 4,052,418,560 | 453 |
| #719: gate-inputs | 145.294 | 233.30 | 3,147,878,400 | 523 |

Main's records check reuses an accepted, current projection. The candidate's
records check instead derives an unaccepted projection: its 453 Programs are
all existing compiled-program reads, none of the six type-check projects.
Main's gate-inputs constructs four tooling Programs and 28 workspace-reference
Programs. The candidate constructs those 453 compiled Programs, 28 workspace
Programs, and seven constructions of each of the six type-check projects.

The five new projects' 35 Program constructions and complete local source/edge
walk take 5.281 seconds, of which construction itself takes 3.077 seconds. The
existing tooling Program phase moves from 6.202 to 7.485 seconds. The added
type-project component is therefore about 6.6 seconds; the minutes and most of
the new work come from live derivation of the unaccepted native projection.
The owner is retained and normal history learns the observed peaks. No cheaper
selection projection, memo or cache was introduced.

Seven constructions per type-check project, 42 for six projects, are a possible
later cleanup: if the requests are proven identical, one construction per run
could remove repeated work. This measurement does not establish cross-context
request equivalence, and the small saving does not justify adding reuse here.

## Finite evidence

Proof source is de099076e12bbbd0f026a8ef7322e27668c357a7 on landed
f6a8a022e329405eeec53779ea615a51726b45e3. Only this Markdown record follows it.
Raw output stays under /home/akisarou/.cache/nts-scratch/719 and the supported
run /home/akisarou/.cache/nts-landing/runs/here-de099076e12b-1794810627807.

The manifest is /home/akisarou/.cache/nts-scratch/719/raw-evidence-v1.json,
SHA-256 `1f9874abbc9bec9244f633726d3535859224a292939eb6a9d33a2710032e4196`.
It binds 311 artifacts, 57,343,217 bytes and 315 exact
Git receipts, including source-path absences. Cited refs retain earlier proof
sources. The verifier re-reads artifacts and immutable Git blobs; readiness and
independent peer authentication bind the subsequent Markdown-only tip.

Direct deciding receipts:

- landing.json, the completed 20-PASS owner result: SHA-256 `aaebfb1af045340d2f9df81f65d5a1a63fa246fb633c707f59f50b1929ae1a29`.
- attempt-2/summary.json, the successful memory retry: SHA-256 `973959b3b1cad151c374a3bdc3f094283b5bcb61711d467e7fefd1b40adc7bea`.
- supported-v2/result.json, the separately retained external exit 1: SHA-256 `90f8703475b3ee91dd7a59053376325bd4eadcf6a2f08de55dfffc5c8eece9f5`.
- project-cost-pair-v1/summary.json, the ordered cost and Program-count comparison: SHA-256 `1f6ab9c4919cc1cf690bfd86ceb933c7988569c733205aab9c67479fe6a2a590`.
