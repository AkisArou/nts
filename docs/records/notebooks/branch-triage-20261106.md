# Branch and pull request triage, 2026-11-06

Before new work starts under [how we work](../../workflow.md), every branch the
fresh start kept was read by two review agents and given one verdict: landed
already, land now, keep as a task, or delete. Commits that records on `main`
cite stay reachable through `refs/cited/<sha>` whichever way a branch goes.
The `node/*` branches (#193 and Node 26) and the `compiler/managed-coercion*`
rounds (#159) are not here: their agents are landing them now and then delete
their own rounds.

## Land now (17)

| Branch | Effort | Why, or what it needs |
|---|---|---|
| `coordinator/benchmark-ports-315` | L | #315: fold in helper4/ares6-family (replaces the 4 ARES-6 commits; squash) and helper4/octane-namespace (04541dc07, bc46cdb3d, 8af049a8b); add clbg-pidigits/regex-redux ref.provenance.json, oracle counts for 37 JetStream+CLBG cases, compile-outcome rows for 46 cases x 3 backends; re-record helper4's oracle counts on main's pin |
| `helper4/ares6-family` |  | inside #315 (Air's Proxy and ML's eval restored to upstream) |
| `helper4/octane-namespace` |  | inside #315 (RayTrace helpers, provenance and domains, oracle counts) |
| `coordinator/gate-order-333` | S | #333, reviewed; owes the tooling suite plus the full gate |
| `coordinator/exit-after-output` | S | #329; 25 tools still end with a bare process.exit |
| `tsrs/c-memory-after-capture-repair` | S | land c_memory_contracts.rs, native_invariants.rs additions and the owed rule (graph.rs fix already on main) |
| `helper/awfy-cd-havlak-qualification-evidence-20261030` | M | #26: CD and Havlak rows (provenance, domains, oracle counts) |
| `helper/awfy-ports-parked` | M | #26 with the above: Richards, DeltaBlue, Json, Storage as refused rows |
| `helper/write-once-module-function` | S | tests only: drop the old oracle-counts.json hunk, record the control's count, recheck on main's pin |
| `compiler/exceptional-transfer-producer` | S | tests only (91abed82d, d888256b8, 5e4e8db77, 0d213a4a6, b5d3e8af9): indirect-throw guards and the quiet-base-owner outcome, re-recorded on main's pin; then #18 is a task |
| `compiler/implicit-member-call-effects` | S | only 0e31025cc: overflow checks and debug assertions in the nts-dev profile, matching the gate's test profile |
| `compiler/octane-equality-assign` | M | #147 loose equality and Object.assign: build, test, re-record 4 outcomes and the Octane refusals; conflicts with #159 in assertions.rs |
| `compiler/runtime-raise-effects-submit` | S | 4 of 5 commits landed; take only fold.rs's comparison fold on known non-NaN values plus its toFixed test |
| `jvm/exact-region-certificates` | S | only fd95770e2: a Java float can be +-Infinity, main gives it a finite range |
| `runtime3/jvm-fixed-view-resize` | S | only 75d055cff: a fixed view over a shrunk buffer refuses instead of reading stale bytes on the JVM |
| `runtime3/llvm-addon-class-main29107` | S | test only (#181, LLVM addon class fails to load); best landed with the fix |
| `runtime3/napi-function-exports` | S | one refusal fixture and its control |

## Keep as a task (the branch stays, named in plan.md) (8)

| Branch | Effort | Why, or what it needs |
|---|---|---|
| `tsrs/335-gate-memory` |  | #335, tsrs2's held WIP |
| `tsrs/3b-mainac1b-namespace-source-preview` | L | #188: cherry-pick 3e8c1cab3 alone (3 conflicts), build, records, schema check |
| `helper4/lifetime-field-overwrite-finding` |  | #126 leak fixture; lands with the fix |
| `chromium/svg-value-types` |  | waits on a compiler fix (lib.dom alias returned as a different opaque type must refuse) |
| `compiler/collection-tagged-semantics` | L | #158 writer planner: 21 WIP commits, design note first; should fix the two a-widened-map-read-through-its-original-view outcomes |
| `compiler/implicit-member-call-effects-025` | L | #113 A and #138: ~7k lines, 718 behind, ~25 conflict hunks; skip its 18k-line evidence commit |
| `compiler/llvm-linkage-nsw` | M then L | #97: land 7858d092d (nsw, final-link preemption) with LLVM benchmark rows, then rebuild linkage-by-product and emission pruning on main's SourceSymbols::is_public |
| `runtime3/c-number-kinds-clean-stack` | L | #91: 3 of 8 commits landed; ~8k lines conflict in 12 files and owe renames after 4dcd0a422 |

## Keep (the paused Chromium lane) (1)

| Branch | Effort | Why, or what it needs |
|---|---|---|
| `chromium/counter-tree-profile` |  | the paused lane's current work (606217f41) |

## Already on main (delete the branch) (16)

| Branch | Effort | Why, or what it needs |
|---|---|---|
| `tsrs/315-compile-records-land` |  | aa1f8687a..9eb6c45f4 |
| `helper/web-crypto-pr110` |  | 88 of 90 commits identical; corpus import 8fd91327a |
| `helper/web-crypto-pr109-before-direct-intrinsics-20261029` |  | 2cfd538ee, cb85ea34b, 93cace73a, 7fb7cc60b, 8fd91327a |
| `helper/web-crypto-pr109-before-process41-refresh-20261029` |  | only the corpus import differs (8fd91327a) |
| `helper/web-crypto-pr109-before-quota-override-20261029` |  | same |
| `helper/crypto-pr109-before-liveness-20261029` |  | same |
| `helper/base64-after-crypto-replay-20261030` |  | 190516c52, 8d04df937, 08d057cd7 |
| `helper/web-chain-pr14` |  | d16eef952, 518b4dd8d, 7bc8ce993, 985f70758, c7c3b1fe8 |
| `helper/web-test-completion` |  | #49 is b9c0d9884 |
| `helper/source-oracle-plans-before-landed-ingress-20261029` |  | later form 415047f47 |
| `chromium/checkpoint1-measured-b3ffb1f9e` |  | 89dbe3e6f, 5d8060c6c, 0566e6ade, f1d69410a |
| `chromium/entry-world-dcheck` |  | a09a8fbe0 |
| `chromium/observer-ownership` |  | de1bc8414 |
| `chromium/union-sequence-radii` |  | 4c8c52d0e |
| `jvm/provider-package-identity` |  | b23045299, 5ec1d05c7, 866b98124 |
| `runtime3/napi-publication-manifest` |  | f984de001 (+05f213176) |

## Delete (24)

| Branch | Effort | Why, or what it needs |
|---|---|---|
| `tsrs/benchmark-outcomes` |  | holds no records; its scope part is on main (aa1f8687a), rest is WIP that conflicts |
| `tsrs/315-compile-records` |  | earlier round of the landed records |
| `tsrs/245-recording-filesystem` |  | file-read recorder, 8-14 more days by its own estimate; the new workflow selects checks by path and catches misses after landing |
| `tsrs/174-record-integrity` |  | replaced by "the full check writes records; getting worse is red" |
| `tsrs/gate-window-preparation` |  | 853 behind; its live items are plan items already |
| `tsrs/build-failure-summary` |  | identical to two commits of gate-window-preparation; its defect becomes a task |
| `tsrs/timeout-callers` |  | 3 of 7 commits on main; the rest conflict in 11 files; #83 stays a task |
| `tsrs/builtins-observed-roots-qualified` |  | 4 of 5 commits inside 3e8c1cab3; feeds a replay nothing on main uses |
| `tsrs/node-cache-retention` |  | #324 already rides on node/oracle-e039 |
| `tsrs/node-cache-retention-unfolded90` |  | same tree as above |
| `tsrs/3b-source-refusal-correction` |  | earlier round; 149 of 162 files identical in 3e8c1cab3 |
| `helper/brotli-native-111` |  | provider landed (71a36e152); four Brotli rows wait for #196 as a task |
| `chromium/canvas-v8-profile` |  | superseded by checkpoint 1 (89dbe3e6f) |
| `chromium/checkpoint1-context-control` |  | a measurement control (its tree in the Chromium checkpoint cache stays, detached) |
| `chromium/per-call-entry` |  | candidates 1 and 3 landed (fbb1f1666, ce0285fcc); 2 and 4 rejected by measurement |
| `compiler/arena-api` |  | first caller is memory stage 3; 1,531 behind; commit kept by refs/cited/252b3ba25611 |
| `compiler/collection-tagged-semantics-pre-view-landing` |  | same commit as the branch above |
| `compiler/getter-identity-fix` |  | the whole #185 fix is inside #159 (8d37cfdc8); #159 re-records the #185 outcome |
| `compiler/getter185-on276` |  | same patches as getter-identity-fix's first two |
| `compiler/map-semantics-before-licence-rebase` |  | licence part (9ff634a7f) and fixtures (d415067b7) landed; the rest continues in collection-tagged-semantics |
| `jvm/integral-producer-evidence` |  | subset of the branch above plus an out-of-date measurement; #28 redone from docs/records/notebooks/integral-arithmetic-regions.md |
| `runtime3/addon-private-names` |  | ABI commits landed (96f0e1b85, 483c40b6c); the naming draft was never built and uses the C-only handoff the agreed design rejects |
| `runtime3/c-number-kinds` |  | same tree as clean-stack minus one test |
| `runtime3/napi-function-values-d2c` |  | never ran green, built on a C-only seam the agreed design replaces; commit kept by refs/cited/d2cfee7b56b4 |

## Pull requests

- **#54** (HTML base64): on `main` as 7c0d7f18e; close it.
- **46 benchmark ports** (#9, #11, #19–#23, #31–#34, #44, #46, #48–#50, #53,
  #55–#59, #61–#68, #75–#80, #101–#108, #119, #120): inside
  `coordinator/benchmark-ports-315`; they close
  when #315 lands.
- **#69–#74** (async and bigint JetStream ports): stay open until the
  asynchronous benchmark harness (#56) exists.
- **#118** (JetStream TypeScript lib): stays open until its licence check;
  then it joins the ports.
- **`chatgpt/source-globals-bootstrap`** (a branch with no pull request):
  stays until someone checks whether main bootstraps the source globals
  another way.
