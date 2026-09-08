# `nts deps`

Acquires the TypeScript behind a project's dependencies, and says what it could
not acquire.

```sh
nts deps path/to/tsconfig.json          # acquire, and report
nts deps path/to/tsconfig.json --dry-run   # report, write nothing
nts deps path/to/tsconfig.json --verbose   # show every specifier mapping
nts deps path/to/tsconfig.json --json      # the same thing, for a machine
```

```
4 of 4 dependencies acquired

  @demo/lib  1.0.0      workspace source, in place
  lru-cache  11.5.2     source map, 3 files
      3 × TS2552: Cannot find name 'process'. Did you mean 'PROCESS'?
  mitt       3.0.1      source map, 1 file
  zod        4.5.4      shipped TypeScript, 96 files

compile with: packages/app/tsconfig.nts.json
```

The unit is what the program *imports*, not what its manifests declare — the
same project's two unused dependencies are not reported, and `zod/v4` maps to
`src/v4/index.ts` exactly rather than to eleven guessed entry points.

Acquisition also runs from the build — `project()` in the CLI — so no second
command is needed. `--no-acquire`, or `NTS_NO_ACQUIRE=1` for a whole shell,
turns it off.

## Why this exists

`compiled_files` in the frontend drops every file TypeScript resolved out of
`node_modules` — whatever route resolved it. A `paths` override does not help
and neither does a custom `exports` condition, because the discriminator is the
file rather than the specifier. The identical bytes anywhere else become a
module and lower.

So acquiring a dependency is not a compiler change. It is writing the
implementation somewhere the compiler already looks, and generating a `paths`
that points at it. That is all this crate does.

## What it writes, and what it never touches

```
<workspace>/
  .nts/vendor/<name>@<version>/…   recovered source, one copy per workspace
  .nts/deps.lock                   artifact identity and source identity
  <project>/tsconfig.nts.json      extends the project's config, adds the paths
```

The project's `tsconfig.json`, `package.json` and `node_modules` are read and
never written. That is a correctness rule, not tidiness: `nts check` compares a
compiled program against node running the same TypeScript, which only works
while the program still resolves its dependencies the ordinary way. Rewriting
the developer's resolution would break the oracle, and the editor with it.

## Where the specifiers come from

Not from here. tsgo resolves the program this compiler compiles, so its answer
is the only one that binds, and `resolution.rs` reads it out of
`--traceResolution`. That is also strictly better informed than a manifest walk:
it knows which subpath a program imported, which version each importer got, and
how a subpath *pattern* expanded.

What resolution does *not* answer is where the implementation is. A checker
resolves to declarations — `lru-cache` lands on `dist/esm/index.d.ts` — so
`recover.rs` still has to find the source behind that answer.

Acquisition runs to a fixpoint, because resolution is taken from the program as
it stands and the program as it stands does not contain source not yet
acquired: a dependency's own dependencies are invisible on the first pass.

## The routes

| route | what it means |
|---|---|
| workspace source | the developer's own package, pointed at where it lives |
| shipped TypeScript | the entry names a `.ts` and the package published it |
| source map | the entry is generated and `sourcesContent` carries the original |
| source map has holes | `sourcesContent` is partly `null` — half a module graph |
| bundles N sources | a map naming several sources and no identifiable entry |
| published JavaScript only | nothing to recover |

Measured over a 458-package closure in [`docs/npm-deps.md`](../../docs/npm-deps.md),
26 packages have their entry point's implementation recoverable. The rest are
reported, never substituted: there is no JavaScript fallback in this compiler.

## Acquired and buildable are different claims

The pass that resolves is a typecheck, so its complaints come free. They are
attributed to the package whose recovered source they are about and grouped by
error code — forty instances of `Cannot find name 'process'` are one fact about
a package's build environment, not forty facts.

```
lru-cache  11.5.2   source map, 3 files
    4 × TS2339: Property 'unref' does not exist on type 'number'.
    3 × TS2552: Cannot find name 'process'. Did you mean 'PROCESS'?
```

Only the vendor tree is reported: an error in the developer's own code is theirs
and was there before acquisition. Measured on a 141-package corpus, seven of
fourteen acquired packages arrive with nothing to say here.

Ambients are reported and never supplied. They are host globals, and a program
compiled to a native target may not have them — source that needs `process` is
source with a requirement, and satisfying it in a generated config would hide
the requirement at the moment it became relevant.

## Six things it is careful about

**A workspace package is pointed at, never copied.** `packages/app` importing
`packages/lib` resolves through a `node_modules` symlink, so the frontend used
to drop the developer's own TypeScript as external. A copy would fix that and
then go stale on the next edit, so the generated `paths` names the real source.

**Only what the entry reaches is copied.** The module walk follows relative
imports with TypeScript's extension substitution, so a package's tests and
unreferenced files stay out of the program.

**Which source a specifier *means* is a separate question from which files can
be recovered.** A `tsc` output maps one generated file to one source and the
answer is forced; a bundle maps one to everything that went into it and records
no entry. `lru-cache` bundles `index.ts` with two `diagnostics-channel`
modules, and taking the first source mapped its main specifier at a file it does
not mean. Where it is not knowable, it is reported instead.

**A module graph is recovered whole, or reported.** A `tsc`-style build emits
one file per input, so the entry's own map carries the entry and nothing else;
`minimatch` first arrived as `src/index.ts` with five dangling imports. Recovery
indexes every map in a package and walks imports between the sources those maps
*state*. Where a module emits nothing and appears in no map — a type-only one —
the file the package ships at that path is taken if it is there, and reported if
it is not.

**Source that cannot build is refused, not vendored.** `drizzle-orm` writes
`~/entity.ts` throughout and publishes no tsconfig defining `~`, which was 2,850
of a corpus's 3,091 errors. A partial recovery presented as a success is the one
thing this must not do.

**Map-declared paths are treated as hostile.** They are normalised, `../` is
folded rather than honoured, and anything that would land outside the vendor
root is dropped rather than clamped. `tar`'s own map names paths under a bundled
`node_modules`.

## Layout

| file | what it owns |
|---|---|
| `resolve.rs` | finding installed packages, the closure, relative-import resolution |
| `manifest.rs` | `package.json`, and ranking the files its `exports` offers |
| `recover.rs` | the routes: shipped TypeScript, source maps, base64, module walk |
| `resolution.rs` | asking tsgo where every specifier went, and what it complained about |
| `emit.rs` | the vendor tree, the generated config, the lock, pruning |
| `workspace.rs` | monorepo roots, and telling a sibling from a dependency |
| `report.rs` | what the developer reads |
