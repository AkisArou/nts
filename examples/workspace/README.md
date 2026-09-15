# A workspace shaped like a real one

**This is a design fixture, not a buildable project.** Nothing here compiles
today, and much of it names capability this compiler does not have. It exists so
the build system is argued against a concrete tree instead of against a config
snippet -- which is how the previous round of this design went wrong, by being
written from inside one lane.

It is deliberately **not** a pnpm workspace yet: no `pnpm-workspace.yaml`, no
`package.json`, no dependencies. Those decisions come after the shape is agreed,
not before.

## It is invisible to the gate, on purpose

The gate's example globs are `examples/*/tsconfig.json`, **depth one**, and this
directory has no `tsconfig.json` at its root -- the same reason
`examples/interop/<name>/` has never been in the 205. `nts-suite` reads
`third_party/typescript-go/testdata/`, not here. The interop step globs
`examples/interop/*/build.sh`, and nothing here is under `interop`. Checked
before this directory was created, because a fixture that silently joins a
floor is worse than no fixture.

If any of that changes, this directory becomes 40-odd new corpus entries that
nobody meant to add.

## Project references carry the dependency graph

Every package is a **composite** TypeScript project and every app **references**
the packages it imports. `tsconfig.solution.json` at the root references all
thirteen, so `tsc -b` builds them in dependency order.

That placement is the point rather than a convenience: **the graph lives in
tsconfig, because tsconfig is the source of truth.** `nts.config.ts` says what
gets *built* -- targets, backends, hosts, native source roots -- and says nothing
about which packages a program is made of. The two files cannot disagree about
the graph because only one of them describes it.

Two consequences worth knowing before editing:

- **Composite projects must emit declarations**, so `tsconfig.base.json` does not
  carry `noEmit`. Packages set `emitDeclarationOnly` with an `outDir` of
  `.types/`; apps set `noEmit` themselves. `nts` does the real emitting -- `tsc`
  here only typechecks and publishes `.d.ts` for the graph.
- **The solution file is `tsconfig.solution.json`, not `tsconfig.json`**, and
  that is a constraint of this repository rather than a preference: the gate
  globs `examples/*/tsconfig.json` at depth one, so the idiomatic name would
  enrol this fixture in the 205. Anyone "fixing" the name adds 40-odd corpus
  entries by accident.

## The three axes, made concrete

| axis | what varies here |
| --- | --- |
| **artifact kind** | `apps/*` produce artifacts; `packages/*` are consumed by them |
| **target** | android, ios, macos, linux, windows, node, plain-native |
| **backend** | JVM for android; LLVM for apple/linux/windows; C for node and native |

`apps/react` is the one that crosses: **one entry, four targets**.

## apps/

| app | target | backend | what it exercises |
| --- | --- | --- | --- |
| `android` | android-29 | jvm | JVM backend, Android host, a package with Java in it |
| `ios` | ios-17 | llvm | LLVM + triple + UIKit host; C-level native interop |
| `macos` | macos-14 | llvm | same backend, different host -- proves host is its own axis |
| `linux` | linux-gnu | llvm | GTK host |
| `windows` | windows | llvm | a target with no POSIX |
| `node` | node-addon | c | `emit-c --napi`; the only app that is a *library* to its host |
| `native` | linux-gnu | c | a plain CLI executable, no UI host at all |
| `react` | android, ios, macos, windows | jvm + llvm | **one product, four targets**, two backends |

`node` and `native` share a target family and differ in artifact kind, which is
the pair that shows why those two axes cannot be merged.

## packages/

Chosen for the combinations they force, not for coverage.

| package | native? | targets | needs `nts.config.ts`? |
| --- | --- | --- | --- |
| `storage` | no | all | **no** -- the case that proves the rule |
| `telemetry` | no | all | **no**, but its surface diverges per platform |
| `crypto-core` | C only | all | yes -- one C implementation, no per-platform split |
| `biometrics` | Java + C | android, ios **only** | yes -- a strict subset of targets |
| `notifications` | Java + C | all five | yes -- the showcase |

**Two of five need no config**, which is the rule from `docs/nts-config.md`
made visible: *a config file is required exactly where there is a build step.*
`storage` and `telemetry` are ordinary TypeScript and get their type environment
from `types: [...]` in their own `tsconfig.json`.

### Why each one is here

**`storage`** -- pure TypeScript, no native, no config. If this package ever
needs an `nts.config.ts`, the rule has broken.

**`telemetry`** -- pure TypeScript, and *still* platform-sensitive: it wants a
monotonic clock, which is a different API on every platform. It has no native
code, so it resolves that through the platform type surfaces alone. This is the
package that makes the **intersection** question concrete: it is written once
and must typecheck against every target its consumers use.

**`crypto-core`** -- one C implementation, no per-platform variants. The simplest
native case, and the one that shows a package can have native code without
having five copies of it.

**`biometrics`** -- android and iOS only. A desktop app depending on it must
fail **at configuration time** with a readable reason, not at link time. This is
the package that asks what a target set *means* when a dependency does not
share it.

**`notifications`** -- the showcase, and the reason this fixture exists:

- **generic TypeScript** (`src/index.ts`) -- the API a consumer sees, with no
  platform in it;
- **per-platform TypeScript** (`src/android.ts`, `src/apple.ts`, ...) -- each
  importing that platform's bindings;
- **per-platform native, in that platform's language** -- Java for Android, C for
  the rest;
- **and a callback**, because a notification tap has to reach a TypeScript
  handler.

That last point is the hard one. `docs/nts-config.md` §6 records the ordering
cycle: TypeScript-calls-native needs bindings generated before the TypeScript is
checked, and native-calls-TypeScript needs the emitted artefacts before the
native compiles. `notifications` needs both, in one package, which is why its
config declares a direction per source root rather than letting one be inferred.

## What this fixture is honest about not having

- **Objective-C.** The Apple platforms would really want it; this compiler binds
  C headers and Java class files, so `native/apple/` is C with a header. Real
  iOS notification work is Objective-C, and that is a gap, not an oversight.
- **AARs, app bundles, `.dylib`, Windows packages.** Produced by nothing today.
  Jars and test APKs come from shell scripts.
- **React.** `apps/react` names a planned feature and carries no dependency.
- **Anything actually building.** No `package.json`, no lockfile, no
  `pnpm-workspace.yaml`.
