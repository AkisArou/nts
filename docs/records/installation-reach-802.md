# A declared Program's missing installation catalog

Issue: #802. Base: `f83ae3e6d4`. Date: 2026-11-16.

#719's record-pending-outcomes tests failed in a warm pool tree with
`reader observation ancestor is not an owned directory: …/node_modules/acorn`.
The tree had never published its installation catalog. The only place that
sees a Program's installed reach is the project owner
(`tooling/gate/project-inputs.ts`). While the catalog is pending, it kept the
Program's `node_modules` reads as plain source observations. The first check
to touch them was the source-parent walk, which reported a symptom.

The project owner now reports `installationReach` only while the catalog is
pending. It comes from the Program's own external-library classification,
named by the resolved `packageId` where an import supplies one. The closure
graph carries it as `installationObligations`. `copyModuleClosure` and
`copyFixtureProject` refuse it through one helper before any source-parent
check. The refusal names the project, the reader, the package and the
`linker.ts work` command.

| Closure | main (`cc8731ddcc`) | This change |
| --- | --- | --- |
| nested `fixtureInput` → `projectConfig`, no catalog | ancestor error | names catalog and command |
| same, published catalog | passes | passes |
| host-only `projectConfig` and modules, no catalog | passes | passes, unchanged files |
| oracle owner reaching a package, no catalog | `unowned installed source` | names catalog |

The counterfactual runs control (a) against main's copier:
`~/.cache/nts-scratch/802/counterfactual.test.ts`
(sha256 `0f656877521c55279fbf4d484204bf7e27e0ac119c419069b572fc3ec1ff26f9`).
The reproduction is `~/.cache/nts-scratch/802/repro6.ts`
(sha256 `0b38074c19b0978ac4e8e7781f3312757375e24bd654b266a0c0c7a301ee4e75`).

## Follow-up card (for the coordinator to file)

**Goal:** Landing selection treats an unmet installation obligation as an
unavailable authority rather than as ordinary source reach.

**Why:** In a tree with no published catalog, `owed.mjs`'s graph records a
declared Program's `node_modules` reads as plain observations and module
edges. It ignores `installationObligations`. A change that reaches an
installed package is then selected as if the package's bytes were repository
inputs, rather than being told that the tree lacks its catalog.

**Design:** `owed.mjs` reads `InputSnapshot.installationObligations` from the
same graph. A non-empty list either forces the declaring reader's steps
(conservative), or refuses selection, naming the catalog and the publishing
command. Both use `refuseInstallationReach`'s wording. The choice depends on
whether the landing check guarantees a published catalog. If it does, an
obligation there is a defect and refuses.

**Paths:** `tooling/gate/owed.mjs` and its tests

**Done when:** A selection control in a tree with no catalog and a change
reaching an installed package either forces the declared steps or refuses by
name. The same control with a catalog selects exactly as today.
