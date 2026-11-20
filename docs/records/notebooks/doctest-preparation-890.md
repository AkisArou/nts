# Doctest prerequisite ownership (#890)

The original doctest entry rebuilt workspace libraries in `nts-dev` after the
release build. Shared preparation now runs the identical selected doctest Cargo
graph with `-- --list`; execution requires its receipt and fresh artifacts.
No reservation formula or runaway boundary changed.

The preparation receipt binds working directory, target, profile and selected
Cargo arguments; it does not identify a commit or source tree. Cargo freshness
validates current inputs, and the first non-fresh artifact stops its owned command
group. Doctest-graph compile failures in pinned preparation occur before the gate
writes a summary, so the full-check reader holds the run without starting a bisect,
as it already does for release-build failures. Direct preparation failure likewise
holds the runner during setup.

The paired scope controls used the same core-source comment and independent
copies of this tree's measured warm history. The original step compiled eight
workspace crates. It exceeded its reservation and grew enough to finish; this
control did not reproduce a kill. The changed path compiled in the admitted
build lifetime and then reused all 169 artifacts, compiling none in doctests.
The original full-check incident at affc55106dc3 had reached its runaway bound.

| Execution | Wall s | Scope CPU s | Ledger peak B | Initial reservation B | Final boundary B | Verdict |
|---|---:|---:|---:|---:|---:|---|
| Original execution after core edit | 8.890 | 7.132 | 1138286520 | 499122176 | 2480930816 | PASS / OVER |
| Shared preparation then execution | 3.022 | 2.951 | 403392880 | 499122176 | 1572864000 | PASS |
| Committed core run execution | 4.794 | 4.072 | 391729864 | 499122176 | 1572864000 | PASS |

Scope CPU uses `cgroup-v2-scope-v1`. Scope peaks use the ledger's retained
resident-charge basis. The original control's final boundary reflects ordinary
measured growth; it is not a policy edit.

The selected core run used committed source control
`4231f2ff425ad843ab5e2f6a29ce99112acdaad4`, with zero dirty inputs. It requested 47
core steps. Doctests and the scheduled build passed. The coordinator accepted
that completed measurement as the task's done-when and directed the proof unit
to stop with 16 unrelated suites still running. This is not a green core
verdict. The scheduled build used
0.242 wall s, 0.194 scope CPU s and
18652928 B peak. The source-control comment is removed from
the final product diff. An earlier dirty-source core attempt was stopped after
the selector correctly refused uncommitted inputs; it is excluded from proof.

## Build cost and disk

Both matched build controls started after the identical core-source edit, with
shared dependencies warm. The first release attempt also rebuilt older shared
dependencies and is retained as warm-up rather than a comparison. These are
cost observations under concurrent load, not a wall-time performance claim.

| Admitted preparation | Wall s | Wait4 CPU s | Ledger peak B |
|---|---:|---:|---:|
| Original release build | 274.95 | 1037.10 | 4805681152 |
| Shared release and selected nts-dev doctest graph | 249.10 | 1030.22 | 4882878464 |

The existing documentation selector controls pass: ordinary Markdown schedules
no build or doctests; Rust prose selects only its own doctests. The shared owner
performs no doctest preparation when unselected, and a doctests-only selection
builds no compiler binaries. The narrowed graph control includes an unrelated
compile-error crate, proving that it remains uncompiled. Warm execution reuses
every artifact. A broken doctest still fails, skipped preparation after an edit
is detected, failed preparation invalidates its old receipt, and retries retain
the successful preparation.

The build disk claim includes `nts-dev` and merges with the same target's
existing claim. These pool profiles already existed; no second target root or
duplicate profile was introduced. Footprints also include release warm-up and
the complete core test build, so their delta is not attributed solely to this fix.

| Target output | Allocated B before | Allocated B after proof |
|---|---:|---:|
| `target/nts-dev` | 11738390528 | 12522692608 |
| `target/release` | 940707840 | 941723648 |
| `target/clippy` | 2263371776 | 2249138176 |

## Scheduling samples

All values are bytes; order is oldest first. Each arm starts with the same
measured warm step samples. The cold compile moves to the existing whole-job
`pinned-build` history, whose observed peak in the focused changed control was
989818880 B.

| Doctests history | Samples B |
|---|---|
| Seed | 360616376, 349132632, 398804504, 362131216, 336336024 |
| Original cold execution | 349132632, 398804504, 362131216, 336336024, 1138286520 |
| Shared preparation then execution | 349132632, 398804504, 362131216, 336336024, 403392880 |

## Retained raw observations

| Path | SHA-256 |
|---|---|
| `/home/akisarou/.cache/nts-scratch/890/cold-before.mjs` | `99ca91748847ea92ee7e621240864e3ff15ab3b30bb8b6a081707e4ed392185d` |
| `/home/akisarou/.cache/nts-scratch/890/cold-after.mjs` | `bb79e5cfa448f86998e804606770051323e6fd98e057716477fa9ac70f5baa8e` |
| `/home/akisarou/.cache/nts-scratch/890/build-costs.mjs` | `68d287a27d86056c5c6369ff1b39c5cef543acb32c0e6456bffc01e5c52e3aab` |
| `/home/akisarou/.cache/nts-scratch/890/build-cost-repeat.mjs` | `5135b11709375c8f1fbf8b47933927fad1ded6132ed79bb2b0c9435bcce798cd` |
| `/home/akisarou/.cache/nts-scratch/890/core-committed.mjs` | `6b7810a34c5c3a9d63412c0e016705dfda68c59c3af0eabfadd2e8594bd44cd6` |
| `/home/akisarou/.cache/nts-scratch/890/history-before.json` | `4526a87cf57014ae0fe53e0ba86a0afd57fa920f77cb269b4f13a7717f61579a` |
| `/home/akisarou/.cache/nts-scratch/890/cold-before/summary.json` | `e2460938bcbd33797cd1ecea977b9c4896d0f32a1a993927f58180c179dfd6ad` |
| `/home/akisarou/.cache/nts-scratch/890/cold-after/summary.json` | `0abd44bec571a42c168cbd891e1ec539333a2dd43e3dbda5f43619cf4f313bc8` |
| `/home/akisarou/.cache/nts-scratch/890/after-costs/steps-v5.json` | `9d83bcf2512d77a6990a12e176acc858c63b4f1052dbd13075f58b079910e279` |
| `/home/akisarou/.cache/nts-scratch/890/build-cost-before-repeat/usage.time` | `afca0a554b0c717678b1cd8bac57161beb53af8e98cc1414ede926b257fc1492` |
| `/home/akisarou/.cache/nts-scratch/890/build-cost-before-repeat/costs/steps-v5.json` | `d9274a043352c75a1071663fa6273a8ec9661a7913b4006ef62aca7b7663d4dc` |
| `/home/akisarou/.cache/nts-scratch/890/build-cost-after/usage.time` | `b67ef223f851ee942d00b98e96ae7b94d2cba3d11c653ececff4a140c9d4f37b` |
| `/home/akisarou/.cache/nts-scratch/890/build-cost-after/costs/steps-v5.json` | `e1a97ae312777c9c552071bede172d486022c39663a2b173472430f77acde9ec` |
| `/home/akisarou/.cache/nts-scratch/890/core-committed/summary.json` | `ece62f124c92e5f289a2aa10bb7102a5f3ccb6841060dee28c35c0a5be72311c` |
| `/home/akisarou/.cache/nts-scratch/890/core-committed/doctests.log` | `e763d3103ec2a9eaf4cdb22864b1fc3a3b76cd59d3cac8e73f64a4f87d4bb640` |
| `/home/akisarou/.cache/nts-scratch/890/core-committed/build.log` | `0b5fe2277fd2b29cc111b76604c482f8ec516047dbc0954657203c5614f4e4db` |
| `/home/akisarou/.cache/nts-scratch/890/target-before.tsv` | `758b67fb57e1ebe6258bc4fbad96940db040bf8afdf4ec3a78abcc0a73183dcd` |
| `/home/akisarou/.cache/nts-scratch/890/target-after.tsv` | `07897c699cf3b3e8f237c9ad84ce63e44a5d0b3157142680f3cc16df5fde08c3` |
