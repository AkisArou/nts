# Modules

How a program's modules, imports and packages are compiled: which import and
export forms work, in what order modules run, how npm dependencies and
`node:*` modules are reached today, and what is refused. For anyone laying out
a program for nts, or bringing a dependency into one.

## ES modules

Every source file is a strict ES module. The program is the entry module and
everything it reaches; TypeScript's checker (tsrs, run inside the compiler)
resolves each specifier, and nts compiles only a program that type-checks.

| Form | |
|---|---|
| `import { x }`, `import { x as y }`, `import { type T, x }` | compiled |
| `import d from`, for `export default function` or `export default name` | compiled |
| `import * as ns`, and members through it | compiled; a member is resolved as a name, not read as a field |
| `import type`, `export type` | erased |
| `export`, `export { x as y }`, `export { x } from`, `export *`, `export * as ns` | compiled |
| `import()` | compiled for a module of the program (below) |
| `import defer` | evaluated eagerly, as an ordinary import |
| `import source` | refused: it loads a module's source rather than its bindings |
| `export =`, `import x = require()` | rejected by the checker under ES module settings (TS1202, TS1203) |

## Evaluation order

Modules run in post-order over their static imports and re-exports, in source
order, starting from the modules nothing imports, so a module's dependencies
run before it, as in node. Cycles are evaluated rather than refused: a module
in a cycle sees the bindings that have already run.

Two differences from node: every module in the program runs at startup,
including one nothing imports, and an `import type` still orders its target
before the importer.

A binding read before it is initialized follows the temporal dead zone:

- a module's top-level code that reads another module's binding before that
  module has run is reported at compile time, NTS1004 (classes are not
  checked);
- within a module, the read throws `ReferenceError: Cannot access 'x' before
  initialization` at run time.

## Dynamic `import()`

`import("./name.ts")` takes a string literal (or a template with no
substitutions) naming a module of the program, which the checker resolves. A
module reached only this way is evaluated on its first import, once, and the
call returns a promise of its namespace. A relative specifier that names no
module gives a promise rejected with `Error("Cannot find module '...'")`.

Refused: a computed specifier ("which names a module only a run-time resolver
could find"), a bare specifier naming a package, and import attributes.

## Top-level `await` and `import.meta`

Both are refused, on every backend: ``NTS1001 a top-level `await` `` and
`NTS1001 a meta property`. Both are decided to be implemented
([Decisions](#decisions)), with `import.meta.url` defined as
`bun build --compile` defines it, which is checked first (register
[L17](../open-questions.md#1-language-and-compiler)).

## JSON and text modules

Not supported yet: no lowering handles a module that is a JSON or text file
(`import data from "./data.json" with { type: "json" }`), although the checker
resolves one under `moduleResolution: "bundler"`. They are decided with
top-level `await` ([Decisions](#decisions)).

## JavaScript files

A `.js` file in the program compiles under `allowJs`, typed by its JSDoc or by
what the checker infers. Its patterns are tested before they read, since
nothing checked the types they claim.

## CommonJS

There is no CommonJS: `require`, `module`, `exports` and `__dirname` are not
provided, and `export =` with `import = require()` is rejected by the checker.
Sources stay strict ES modules, and CommonJS dependencies are decided to come
in through an interop layer, which is not built ([Decisions](#decisions)).

## Packages

The checker resolves a package as TypeScript does, through its `package.json`
(`exports`, `main`, `types`); nts has no resolver of its own. What is compiled
is the program's own files: files under `node_modules` never reach lowering.
The exception is a package that declares a platform surface
(`"nts": { "surface": "c" }`, or `gobject`, `objc`, `winrt`, `win32`, `java`),
whose `.d.ts` files describe a native library.

A package that ships only declarations type-checks, and each call into it is
refused by name: `` `pad`, an imported name whose implementation is not in this
program ``.

So a dependency is compiled from its TypeScript source. When a `package.json`
sits beside the program's `tsconfig.json`, `nts build` first acquires the
source of each dependency the program imports:

1. the TypeScript the package ships, or the `sourcesContent` of its source
   maps;
2. a workspace package, used in place.

The sources are vendored under `.nts/vendor`, and the build runs through a
generated `tsconfig.nts.json` that maps each specifier there. A package that
ships only JavaScript, typed by JSDoc or not, has nothing to recover, and the
build lists it under "these have no TypeScript to compile". Most of npm is such
packages. Compiling their `.js` against their JSDoc and `.d.ts` types, with
hand ports of the most used packages, is decided and not built
([Decisions](#decisions)).

## `node:*`

`runtime/node/` implements node's modules in TypeScript, one directory each,
built and tested today as Node addons ([conformance/node.md](../conformance/node.md)
counts them). No resolver yet maps `node:fs` to `runtime/node/fs` in a
compiled program; a `node:` resolver for all 28 modules on native is decided
([Decisions](#decisions)).
With `@types/node` in the program, `import { readFileSync } from "node:fs"`
type-checks against node's declarations and each call is refused as an
implementation that is not in the program; without them the checker reports
TS2307. `process` and `Buffer` are not globals: they are NTS1100, a builtin no
provider supplies.

## Host modules

Specifiers that name a native library are ambient module declarations, not
files: `c:` for C libraries (`runtime/native/libc.d.ts` by hand, or generated
from a header by `nts bind-c`), `gi:` for GObject introspection, `objc:` for
Apple's frameworks and `winrt:` for the Windows Runtime, the last three
generated from the platform's own metadata, once per SDK. Each target's page
says how: [Calling C](../targets/calling-c.md), [GTK](../targets/gtk.md),
[Apple](../targets/apple.md), [Windows](../targets/windows.md).

A `declare` written in the program's own source is bound as a C function
today. It is decided to name something the environment provides, resolved
through a builtin provider, so a C function is reached only through a `c:`
import ([Decisions](#decisions)).

## `@nts/*`

| Name | What it is |
|---|---|
| `@nts/scalars` | the scalar type names ([numbers.md](numbers.md#scalar-types)), declared by `runtime/native/scalars.d.ts`, which a program lists in its `tsconfig.json` (`target.chromium()` adds it); not yet distributed as a package |
| `@nts/config` | the module `nts.config.ts` imports, evaluated by node ([reference/nts-config.md](../reference/nts-config.md)) |
| `@nts/sdk` | platform declarations, with no implementation yet; decided to become `@nts/app`, nts's own application API for what no web standard covers ([builtins](../foundations/builtins.md#decisions)) |

## Decisions

- `node:*` APIs are native-only for now, and never in a Chromium renderer
  (10-22, decision 8,
  [Builtins and runtimes](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- Only `@nts/*` packages provide `es:*` and `web:*` features; third-party
  packages may provide `host:*` capabilities and their own modules (10-22,
  decision 9, same entry).
- tsrs is the frontend, called in process, with no intermediate steps (10-22
  and 10-23, [Frontend: tsrs](../records/notebooks/decisions-log.md#frontend-tsrs)).
- Top-level `await`, `import.meta`, and JSON and text modules are implemented,
  with `import.meta.url` as `bun build --compile` defines it (L17; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Not built.
- Sources are strict ES modules: CommonJS dependencies come in through an
  interop layer, and nothing is compiled in sloppy mode (L18; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)).
- An npm package that ships only JavaScript is compiled from its `.js`
  against its JSDoc and `.d.ts` types
  ([record 0011](../records/0011-node-js-as-a-source-package.md)) as the main
  path, with hand ports of the top packages (D-4; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
  Not built.
- All 28 `node:*` modules are owed on native, through a `node:` resolver, with
  `process` and `Buffer` as globals in the native profile (G10; 10-28,
  [log](../records/notebooks/decisions-log.md#builtins-and-globals-10-28)).
  Not built.
- `declare` names something the environment provides, through a builtin
  provider; C functions are reached only through explicit `c:` imports (L13;
  10-28, [log](../records/notebooks/decisions-log.md#language-10-28)). Not
  built.
- Namespaces holding values, and declaration merging, are implemented as
  TypeScript emits them (L11; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Not built.
