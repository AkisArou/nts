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
graph emits each package as an `installed-package-reach` row of its existing
`UnavailableInput`, from the one project branch every Program declaration
passes through. Its modes keep the existing contract:

- **`'refuse'`** (`copyModuleClosure`): `describe` throws before any
  source-parent check. The copier adds the remedy its source owns.
- **`'conservative'`** (owed): the row forces the reader's steps through
  owed's existing unavailable-input path.
- **Unasked:** the reads stay plain observations.

`copyFixtureProject`'s oracle owner reads the project owner directly and uses
the same refusal helper. The refusal names the project, the reader, the
package and the `linker.ts work` command.

| Closure | main (`cc8731ddcc`) | This change |
| --- | --- | --- |
| nested `fixtureInput` → `projectConfig`, no catalog | ancestor error | names catalog and command |
| reader module, or `projectConfig` as the entry, no catalog | ancestor error | names catalog and command |
| nested, published catalog | passes | passes |
| host-only `projectConfig` and modules, no catalog | passes | passes, unchanged files |
| oracle owner reaching a package, no catalog | `unowned installed source` | names catalog |
| owed, ordinary change, no catalog | reader's step not selected | reader's step forced |
| owed, ordinary change, current catalog | not selected | not selected |

The counterfactual runs control (a) against main's copier:
`~/.cache/nts-scratch/802/counterfactual.test.ts`
(sha256 `0f656877521c55279fbf4d484204bf7e27e0ac119c419069b572fc3ec1ff26f9`).
The reproduction is `~/.cache/nts-scratch/802/repro6.ts`
(sha256 `0b38074c19b0978ac4e8e7781f3312757375e24bd654b266a0c0c7a301ee4e75`).

## Follow-up

None. Selection receives the obligation through owed's existing
unavailable-input path; `project-dependencies.test.ts` holds its control.
