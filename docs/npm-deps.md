**Build a source-acquisition layer in front of your compiler:** use shipped TypeScript first, extract embedded source-map contents second, and fetch a version-pinned repository checkout third. For packages that need special handling, maintain explicit source recipes.

There is no general npm option that retrieves the original TypeScript. npm distributes the files chosen by the publisher, and those files need not include the original implementation sources. ([npm Docs][1])

All the approaches below preserve your requirement: **you compile TypeScript implementations, rather than falling back to executing the package’s JavaScript.**

## 1. Check source maps—not just `.ts` files

This is the most useful additional place to look.

A package might ship:

```text
dist/index.js
dist/index.js.map
dist/index.d.ts
```

Although there is no separate implementation `.ts` file, `index.js.map` may contain the original TypeScript in its **`sourcesContent`** field. TypeScript’s `inlineSources` compiler option explicitly embeds the original `.ts` contents this way. ([typescriptlang.org][2])

For example, inside a source map you might find:

```json
{
  "version": 3,
  "sources": ["../src/add.ts"],
  "sourcesContent": ["export function add(a: number, b: number): number { return a + b; }\n"],
  "names": [],
  "mappings": ""
}
```

Here, you already have the implementation source. Extracting it is not decompilation; it is reading an embedded copy.

Your scanner should inspect external source-map files and inline source maps referenced by `sourceMappingURL` comments. An inline map can be a data URL embedded in the generated JavaScript, so merely reading the `.js` file as data may be necessary. You do not need to execute it. Source maps can also contain sections with nested maps. ([TC39][3])

The important distinction is:

| What the map contains                                     | What you can recover                                     |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `sources` plus non-null `sourcesContent`                  | Embedded source text for those entries.                  |
| Only `sources` and `mappings`                             | Locations and mappings, **not** the missing source text. |
| A mixture of strings and null entries in `sourcesContent` | Only some of the source files.                           |

The source-map specification makes `sourcesContent` optional and permits null entries. Also, the source text may be JavaScript rather than TypeScript; inspect what you actually recovered. ([TC39][3])

**Do not equate recovering some source files with recovering a buildable package.** Your importer must still check that all referenced implementation files, required type declarations, configuration, and assets are available.

For implementation, I would load recovered sources into a package-scoped virtual filesystem. Do not blindly write filenames from a map onto disk: normalize paths, prevent traversal outside the extraction root, and detect conflicting contents for the same logical path.

## 2. Fetch the repository at the package’s release revision

When the published archive does not contain enough source, use the package’s repository metadata.

For an initial manual inspection, replacing the example with an exact package version:

```bash
PACKAGE='some-package@1.2.3'

# Inspect metadata for precisely this published version.
npm view "$PACKAGE" repository gitHead dist --json

# Fetch its published archive without running package lifecycle scripts.
npm pack "$PACKAGE" --ignore-scripts
```

`npm view` supports selecting metadata fields, and `npm pack` fetches a package archive. The `--ignore-scripts` option disables package scripts. These are inspection commands; they do not imply that your compiled application needs an npm or JavaScript runtime. ([npm Docs][4])

There are three useful pieces of release information.

**Repository URL and package directory.** `repository.url` identifies the repository; `repository.directory` can identify the package’s location inside a monorepo. Retain access to the repository root as well, because your source recipe may need shared files outside that directory. ([npm Docs][1])

**`gitHead`, when present.** npm’s publishing metadata preparation can populate this from the Git HEAD. It is a useful candidate commit, but it is not a guaranteed or authenticated source-to-artifact correspondence. The implementation reads the revision, not a complete snapshot of the publishing working tree.

**Provenance, when available.** npm provenance exposes the source commit and build workflow associated with a publication. This gives you stronger release-origin information than guessing a tag. It still does not replace checking that you have all the inputs needed for your own compilation. ([npm Docs][5])

My resolution policy would be: use verified provenance where available, otherwise investigate `gitHead`, otherwise resolve a release tag and record the resulting full commit ID. **Never silently use the repository’s current default branch for a pinned npm version.**

Also, fetch the repository directly rather than assuming this is sufficient:

```bash
npm install github:owner/repository
```

Installing a Git dependency through npm can involve building and packing the repository. That is not the same operation as obtaining an untouched source checkout, and it may again produce a distribution with the sources excluded. ([npm Docs][1])

### A checkout is not necessarily the complete release input

For your importer, explicitly consider cases such as generated `.ts` files, release-time constants, custom transforms, shared monorepo configuration, or modifications made during publishing.

For a difficult package, I would record these requirements in a source recipe rather than continually guessing from directory names. Comparing public declarations and running compatibility tests can help validate a recipe, but matching the `.d.ts` surface alone does not establish equivalent behavior.

## 3. Maintain explicit source recipes for packages

This is the part I would make a first-class feature of your compiler tooling.

Instead of teaching the compiler that every npm package follows a layout such as `dist/index.js → src/index.ts`, maintain mappings for exact package versions.

For example, a **proposed format for your tool**, not an existing npm standard:

```json
{
  "package": "some-package@1.2.3",
  "source": {
    "kind": "git",
    "repository": "https://github.com/example/project.git",
    "commit": "<full-commit-id>",
    "directory": "packages/some-package"
  },
  "entrypoints": {
    ".": "src/index.ts",
    "./utilities": "src/utilities/index.ts"
  },
  "tsconfig": "tsconfig.build.json",
  "patches": []
}
```

That gives you a place to represent source acquisition, public entry points, configuration, generated inputs, and compatibility patches without modifying your HIR or LLVM backend.

It also lets users provide local overrides:

```text
npm package some-package@1.2.3
    → use ./vendor/some-package/
    → compile src/index.ts
```

For reproducibility, record both the npm artifact identity and the source identity. npm lockfiles already record resolved package locations and artifact integrity; your source lock should additionally record the selected source revision or source-content hash, recipe version, and patch hashes. A hash for the npm tarball does not, by itself, pin a separately downloaded source tree. ([npm Docs][6])

### Separate type resolution from implementation resolution

This distinction matters particularly for your compiler.

A normal TypeScript resolution result can be a declaration file. `.d.ts` files describe types and values without supplying their implementations; they are useful for checking calls, but not for generating the corresponding function bodies. ([TypeScript][7])

I would model the two questions explicitly:

```text
resolveTypes("some-package")
    → declarations or types from implementation source

resolveImplementation("some-package")
    → actual TypeScript implementation entry point
```

Do not stop implementation resolution just because TypeScript successfully found `dist/index.d.ts`.

Also, do not reject an import simply because its text ends in `.js`:

```ts
import { helper } from "./helper.js";
```

TypeScript deliberately supports resolving that specifier to `helper.ts`. Your source resolver needs equivalent extension-substitution behavior where appropriate. This is different from guessing that arbitrary `dist` paths correspond to `src` paths. ([TypeScript][8])

## 4. Give package authors a clean way to support your compiler

For cooperative upstream projects, explicit source publication is much better than reconstruction.

Authors can include their source directory in the npm archive and expose a compiler-specific entry through conditional exports. npm’s `files` field controls archive inclusion, while package exports support custom conditions. ([npm Docs][1])

For example:

```json
{
  "files": ["src", "dist", "tsconfig.json"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "mycompiler": "./src/index.ts",
      "default": "./dist/index.js"
    }
  }
}
```

Here, `mycompiler` is a convention you define, not a built-in npm condition. Your **implementation resolver** selects that branch rather than treating the `types` branch as executable code.

I would define the contract more strongly than “this package contains `.ts` files”:

> The compiler-specific entry point, together with the published files and declared source dependencies, forms a complete source input compatible with the compiler’s documented language and runtime profile.

That leaves room for an upstream package to expose a slightly different, native-compatible implementation when its default implementation requires unsupported runtime behavior.

### Consider native JSR support as a complementary source channel

JSR’s native registry API serves versioned JavaScript/TypeScript source files and package metadata, including exports and file checksums. That can be a useful additional input format for your compiler. ([JSR][9])

Use its native source API rather than assuming its npm compatibility distribution preserves the original TS: the npm compatibility layer transpiles TypeScript to JavaScript. This helps with packages published on JSR; it does not automatically supply sources for arbitrary npm packages or establish equivalence between separately published versions. ([JSR][10])

## 5. Enforce your TS-only requirement across the runtime dependency graph

There are two independent gates:

```text
Can I obtain the implementation source?
                    ↓
Can my compiler and runtime support that implementation?
```

Original TypeScript solves the first question, not automatically the second. TypeScript’s type system deliberately permits some unsound behavior, so passing ordinary TS type checking is not a proof that a program satisfies stricter assumptions your native lowering might make. ([TypeScript][11])

Your compatibility check should therefore decide what to implement or reject: runtime code generation, unsupported object operations, host APIs, module-loading patterns, and any other behavior outside your supported profile. None of this necessarily requires a JavaScript interpreter; it requires an explicit semantic contract.

Apply that check to **every reachable runtime dependency**, not merely the top-level package:

```text
application.ts
  └─ package-a: TS source available
       └─ package-b: TS source available
            └─ package-c: only an unsupported JS implementation
```

In that example, `package-a` is not yet usable just because its own source is TypeScript.

Type-only dependencies are different: declarations can be sufficient when no runtime implementation is needed. Likewise, a declaration can describe a native implementation you deliberately supply—but the declaration does not create that implementation or define its native calling convention for you. ([TypeScript][7])

For genuinely unavailable sources, your choices are to obtain them from the publisher, maintain a compatible TypeScript port or replacement, or report the dependency as unsupported. **`.js` plus `.d.ts` is not a lossless representation of the original TypeScript.** Inferring types or reconstructing an implementation is a different project from retrieving the original source.

## What I would implement first

I would keep your existing compiler pipeline intact and add this in front:

```text
Resolve exact npm dependency versions
    ↓
Acquire sources:
  shipped TS → embedded source-map contents → pinned repository recipe
    ↓
Resolve implementation entry points and source dependencies
    ↓
Validate completeness and compiler/runtime compatibility
    ↓
TS → HIR → LLVM IR → native code
```

Start with a small, tested set of packages and explicit overrides. Add automatic source-map extraction and repository discovery to reduce the work of creating those recipes, but require a complete, pinned source input before compiling.

**The practical solution is a source resolver plus a compatibility/ports layer—not a JavaScript fallback, and not a general attempt to reverse transpilation.**

[1]: https://docs.npmjs.com/cli/v12/configuring-npm/package-json/ "package.json | npm Docs"
[2]: https://www.typescriptlang.org/tsconfig/inlineSources.html "TypeScript: TSConfig Option: inlineSources"
[3]: https://tc39.es/ecma426/ "Source map format specification"
[4]: https://docs.npmjs.com/cli/v12/commands/npm-view/ "npm-view | npm Docs"
[5]: https://docs.npmjs.com/viewing-package-provenance/ "Viewing package provenance | npm Docs"
[6]: https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json/ "package-lock.json | npm Docs"
[7]: https://www.typescriptlang.org/docs/handbook/2/type-declarations.html "TypeScript: Documentation - Type Declarations"
[8]: https://www.typescriptlang.org/docs/handbook/modules/reference.html "TypeScript: Documentation - Modules - Reference"
[9]: https://jsr.io/docs/api "API - Docs - JSR"
[10]: https://jsr.io/docs/npm-compatibility?utm_source=chatgpt.com "npm compatibility - Docs - JSR"
[11]: https://www.typescriptlang.org/docs/handbook/type-compatibility.html "TypeScript: Documentation - Type Compatibility"
