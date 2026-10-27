# The nts commands

Every `nts` command, its flags, what it prints and its exit status. For anyone
building with nts, and for tools that read its output. What a build produces is
declared in [`nts.config.ts`](nts-config.md); this page covers the commands
that read it.

## Usage

```text
nts <command> [project] [options]
```

- **`project`** is a directory, its `tsconfig.json`, its `nts.config.ts`, or
  another tsconfig file named outright. It defaults to the current directory.
  A directory or an `nts.config.ts` means the config's `tsconfig` field, else
  the `tsconfig.json` beside it.
- **Options are long flags**, `--flag value`. Only `-h` is a short flag.
  `--flag=value` is accepted only where a flag below says so.
- **Flags are checked before anything runs.** An unknown flag, or a flag
  missing its value, is an error that lists the command's valid flags. A value
  may not begin with `-`, except `bind-c`'s `--clang`.
- **`--help` or `-h`**, anywhere on the line, prints the usage. So do `nts`
  alone and `nts help`.
- **Dependencies are acquired first.** Every command that compiles a project
  with a `package.json` beside its tsconfig first does what [`nts deps`](#nts-deps)
  does, and compiles against the generated config. `--no-acquire`, or
  `NTS_NO_ACQUIRE=1` for a whole shell, skips it.

## Exit status

| status | meaning |
|---|---|
| 0 | the command did what it says; each entry below says what that is |
| 1 | an error, printed on stderr as `Error: <message>` |
| 2 | `nts frontend` only: the capture completed and the checker reported type errors |

## Refusals, by command

A **refusal** is a construct the compiler does not compile, named with its
reason. The commands treat refusals differently, by design: the inspection
commands compile what they can, and `nts build` refuses to ship a program that
does less than its source says for a missing builtin.

| command | a lowering refusal (`NTS1001`, ...) | a builtin nothing provides (`NTS1100`, `NTS1101`) | a backend decline |
|---|---|---|---|
| `build` | the artifact is built without the refused function; each is named on stderr and the count is printed | **stops before anything is written** | C: fatal where it leaves the C inconsistent; LLVM: fatal; JVM: printed |
| `emit-c` | printed on stderr; exit 0 | printed on stderr; exit 0 | fatal where it leaves the C inconsistent |
| `emit-llvm` | printed on stderr; exit 0 | printed on stderr; exit 0 | printed on stderr; with `--out`, fatal |
| `emit-jvm` | printed on stderr; exit 0 | printed on stderr; exit 0 | printed as `declined:` on stderr; exit 0 |
| `emit-wasm` | any error stops it; nothing is written | the same | the same |
| `check` | printed on stderr as `refused:`; the rest is compared | the same | the same |
| `hir`, `refusals`, `stats` | listed in the output | listed | not reached |

That a lowering refusal does not stop `nts build` is an open question (L20 in
[open questions](../open-questions.md)).

## Shared flags

| flag | taken by | effect |
|---|---|---|
| `--no-acquire` | every command that compiles a project | skip dependency acquisition |
| `--checkers <n>` | the same, and `deps` | the native checker pool's size, 1 to 256; overrides `NTS_CHECKERS` |
| `--out <path>` | `build`, `emit-*`, `bind*` | where output goes; each command gives its default |
| `--entry <name[,name]>` | `build`, `emit-*`, `hir`, `stats`, `regions`, `expect-ir` | the reachability roots, by function name; repeatable. Module evaluation stays a root |
| `--product <name>` | the same | the product of `nts.config.ts` to use where it declares several |
| `--rc` | the same, and `check` | count references (C and LLVM). The JVM and Wasm refuse it: `NTS2001`, memory belongs to the host's collector |
| `--main` | `emit-*`, `hir`, `stats`, `regions`, `expect-ir` | the program is an executable: module evaluation is the root, and `emit-*` writes an entry point |
| `--napi` | the same | the program is a Node addon: `emit-c` writes the Node-API wrapper |
| `--glib` | the same | an executable driven by GLib's main loop instead of libuv's |
| `--backend c\|llvm\|jvm\|wasm` | `hir`, `stats`, `regions` | whose preparation to show; default `c` |

**Memory provider.** `nts build` counts references, because that is what
ships; `--nogc` builds the never-freeing provider instead, which is for tests
only. Every other command uses the never-freeing provider unless given `--rc`.
See [memory](../foundations/memory.md).

**Roots.** Without `--entry` or `--main`, a project whose config declares one
product is rooted at what that product's entry exports; a project with no
config is rooted at every `export`. For an application product, pass `--main`
to inspect what its build keeps.

## Building

### `nts build`

Builds every product `nts.config.ts` declares, for every target each names.

| flag | effect |
|---|---|
| `--product <name>` | build that product only |
| `--os <os>` | build only the targets whose `os` is this; an error if a product has none |
| `--out <dir>` | the output root; default `<project>/.nts/build` |
| `--nogc` | the never-freeing provider (tests only) |
| `--rc` | reference counting, already the default |
| `--entry <names>` | root the program at these functions instead of the product's entry |

- **Needs a config.** With no `nts.config.ts` beside the tsconfig it stops. A
  config with no products builds nothing, except that a package declaring
  native headers and `targets` generates the bindings its own sources import.
- **Each target's output** goes to `<out>/<product>/<target id>[-<arch>]/`.
- **Refuses before writing:** a kind the target cannot package, an app bundle
  with no `id`, a missing Android SDK or toolchain, a package that does not
  claim the target, a dependency resolver the build cannot read. Each names the
  product, the target and the fix.
- **Then, per target:** bindings for the `c:` modules the program imports,
  generated from the headers packages declare; emission; compilation through an
  object cache (`build.cache` in the config); linking; packaging.
- **Prints** ``building `<product>` for <target> into <dir>``, each artifact's
  path, notes from dependency claims, and finally `<n> artifact(s) under
  <root>`, with `missing <k> refused function(s)` when lowering refused any.
- **Writes the build-system hooks** `integrate` names, after the artifacts.
- **Exit status:** 0 when every target built; 1 at the first that could not.

### `nts check`

Compiles the project, runs the compiled program and node on generated inputs,
and compares the answers.

- **What it compares:** every function the entry module exports whose
  parameters and result are numbers, booleans or strings (a result may also be
  a promise of one, or of nothing). Inputs come from pools chosen to reach the
  edges: both zeros, the `int32` and `uint32` boundaries, the largest exact
  integer, fractions and `NaN`; empty, wide and astral strings.
- **How:** by bit pattern. The `Math` functions the specification leaves
  approximate match within 4 ULP ([numbers](../foundations/numbers.md#math)).
- **Backend:** `NTS_BACKEND` (`c` by default, or `llvm`, `jvm`, `wasm`).
  References are counted under `--rc` or `NTS_RC=1`.
- **Prints** the number of cases checked, up to 20 disagreements (`nts` and
  `node` lines), up to 5 aborts, and separate counts for cases the program
  declined, cases that timed out, and cases matched only within the tolerance.
  It ends with `agreed on every case`, or `agreed on every case it compared: <n>
  of <m>`.
- **Exit status:** 1 on a disagreement, an abort that is not the program
  declining its input, or when no case could be compared; 0 otherwise,
  including `nothing to check` when no function qualifies.
- Needs `node` on `PATH`.

## Emitting

The `emit-*` commands render one backend's output without a config's packaging.
They are what tests, harnesses and people reading generated code use.

### `nts emit`

Emits several backends from one frontend capture and one raw lowering.

| flag | effect |
|---|---|
| `--backends <list>` | required: a comma-separated subset of `c,llvm,jvm,wasm`, each once; also `--backends=<list>` |
| `--out <dir>` | required: each backend writes into `<out>/<backend>/`; also `--out=<dir>` |
| `--host node\|browser` | the Wasm glue's host; also `--host=<host>` |
| `--os <os>` | the LLVM backend's target OS |
| `--text` | the JVM listing |

Each backend's output is printed with a `[<backend>]` prefix, and
`<out>/emit.json` records each backend's directory, status (`completed`,
`failed` or `blocked`), exit code, stdout and stderr. Exit 1 if any backend
failed.

### `nts emit-c`

Renders the program as C.

- Without `--out`, prints the program's C on stdout: readable, not buildable.
- **`--out <dir>`** writes `program.c`, `program.h` and the runtime files the
  program needs (`nts_runtime.c`, the Unicode tables where it converts case,
  and so on), and `native_witness.c` where a native binding is reachable.
  - With `--main`, also `main.c` and the event-loop host (`nts_uv_host.c`, or
    GLib's under `--glib`), and it prints the `cc` line that builds them.
  - With `--napi`, also the Node-API wrapper `addon.c`, naming each export it
    cannot wrap.
  - Under `--rc` it prints `compile the runtime with -DNTS_PROVIDER_RC`, which
    the runtime needs to free.
- **Exit status:** 0, refusals included (on stderr). 1 when an emitter decline
  would leave the C inconsistent, or when `--main` is given and the program's
  top-level code was declined.

### `nts emit-llvm`

Renders the program as textual LLVM IR.

- Without `--out`, prints the IR on stdout; declines are printed on stderr.
- **`--out <dir>`** writes a buildable program as `emit-c --out` does, with
  `program.ll` in place of `program.c`. A declined function is then fatal.
- **`--os <os>`** renders for another OS's calling convention (`windows`,
  `macos`, ...), so it can be read without a machine that runs it.

### `nts emit-jvm`

Renders the program as class files.

- **`--out <dir>`** writes the classes, under the package path (`nts/gen` by
  default), and `nts-runtime.jar` beside them. Without it nothing is written.
- **`--text`** prints each class and its methods with their descriptors,
  disassembled from the bytes written.
- Declines are printed as `declined: <code> <message>` on stderr; exit 0.

### `nts emit-wasm`

Renders a WebAssembly module and its JavaScript glue.

- **`--out <dir>`** is required. It receives `program.wasm`, the glue
  (`program.mjs`, `program.instance.mjs`), the manifest `program.wasm.json` and
  `program.origins.json`, which maps instructions back to sources.
- **`--host node|browser`** chooses the glue; default `node`. Also
  `--host=<host>`.
- Prints the module's size and its exports and globals, and each export the
  module does not publish, with why.
- **Exit status:** 1, with nothing written, when preparation or the emitter
  declines anything.

## Bindings

Each binder writes TypeScript declarations for a foreign surface. The same
generators also run without being asked: `nts build` binds the `c:` modules a
program imports from the headers its packages declare, and every compiling
command generates the platform surfaces (`objc:`, GIR, Windows) its imports
need ([nts.config.ts](nts-config.md#platform-type-surfaces)).

### `nts bind-c`

Generates a declaration module from C headers, for named items only.

| flag | effect |
|---|---|
| `--module <name>` | required: the module the declaration file declares |
| `--header <header>` | a header to read; repeatable |
| `--define <macro>` | defined before every include; repeatable |
| `--record <tag>` | a struct or union to describe; repeatable |
| `--fn <name>` | a function to declare; repeatable |
| `--const <NAME[:brand]>` | a constant to read out of the headers, typed `c_int` unless a brand is given |
| `--no-escape <function:parameter>` | an argument the caller asserts is not retained, which lets a call pass frame storage |
| `--alias <tag=Name>` | the TypeScript name for a record tag |
| `--clang <argument>` | passed to clang, such as `-I`; may begin with `-` |
| `--out <path>` | where the declarations go; default stdout |
| `--constants-out <path>` | where the constants module (a `.ts`) goes; default stdout |

It runs clang as a subprocess (`NTS_BIND_CC`, else `CC`, else `clang`), reads
`-ast-dump=json` for the structure and checks the result against
`-fdump-record-layouts`. It derives signatures only: what a function keeps is
the author's claim (`--no-escape`). A build compiles the binding's witness
against the real headers.

### `nts bind-objc`

Generates an `objc:` declaration module from macOS framework headers.

- **`--module objc:<name>`** and at least one **`--framework <name>`** are
  required, with a `--class`, a `--name` or `--package`.
- `--class`, `--protocol`, `--function` and `--name` select what to bind;
  `--package` binds the first framework whole, as a package of its own,
  re-exporting the classes it takes from the frameworks named after it.
- `--sdk <path>` is the SDK (else `NTS_APPLE_SDK`, else
  `~/.cache/nts/apple/MacOSX.sdk`); `--target <triple>` defaults to
  `x86_64-apple-macos13`. Swift names come from the SDK's symbol graphs, or
  `--symbols <dir>`.
- `--header <path>` with `--project-symbols <dir>` binds a project's own
  header (`--include` and `--framework-search` add search paths).
- `--witness <path>` and `--values <path>` write the witness and the values
  module; `--out <path>` the declarations, else stdout.

### `nts bind-gir`

`nts bind-gir <Namespace-Version>` binds a GObject-introspection namespace
(`Gtk-4.0`) and every namespace it includes: one `.d.ts`, one `.values.ts` and
one `.refused.txt` each, into `--out` (default `.`).

- **`--gir-dir <dir>`** is searched first, then `GI_GIR_PATH`, `XDG_DATA_DIRS`
  and the system directories.
- **`--header`, `--package`, `--define`**, each `<Namespace-Version>:<value>`,
  add headers, pkg-config packages and macros the GIR does not name.
- Each declaration is checked against the installed headers, so the output
  depends on the machine as well as the GIR.

### `nts bind-winmd`

`nts bind-winmd <namespace>...` binds Win32 metadata namespaces, and declares
every type they reach in its own namespace's module: one `.d.ts`, one
`.values.ts` and one `.refused.txt` each. `--winmd <file>` names the metadata,
`--arch <arch>` the architecture (default `x86_64`), `--out <dir>` the output
(default `.`).

### `nts bind`

Generates declarations for a Java package from class files.

| flag | effect |
|---|---|
| `--jar <path>` or `--classes <dir>` | the input, exactly one of them; a jar is unpacked with `unzip` |
| `--package <name>` | required: the package to bind (anonymous classes excluded) |
| `--out <dir>` | required: receives `<package>.d.ts` |
| `--prelude` | write a namespace, `<package>.prelude.d.ts`, instead of a module |
| `--self-contained` | leave out members that name classes outside the input, and say how many |
| `--members <file>` | bind only the members listed; blank lines and `#` comments allowed |
| `--overrides <file>` | references the class files do not mark non-null that are |

A class it cannot represent is refused by name, never half bound. JVM calling
contracts travel in the declarations' JSDoc (`@ntsJvm`).

### `nts deps`

Acquires the TypeScript behind the project's npm dependencies and reports what
could not be acquired: no JavaScript fallback exists, so a dependency without
TypeScript is named here rather than refused later. It writes
`<workspace>/.nts/` and `<project>/tsconfig.nts.json`, and nothing else.

| flag | effect |
|---|---|
| `--dry-run` | report only; write nothing |
| `--verbose` | show every specifier mapping |
| `--json` | the same report, for a machine |

## Inspecting

Each reads the project through the same frontend a build uses. `hir`,
`stats`, `regions`, `expect-ir`, `facts`, `refusals` and `layouts` stop with
exit 1, `the program does not typecheck`, when the checker reports an error;
the others report what the frontend captured either way.

| command | prints |
|---|---|
| `frontend` | the capture: files, nodes, types, symbols, modules, resolved calls, folded constants, time, the snapshot's digest, what is reachable, and every diagnostic. Exit 0 clean, 2 with type errors, 1 when the capture failed |
| `types` | every type the frontend resolved, as the semantic schema records it, then base types, signatures and bound DOM types |
| `hir` | the lowered program, function by function, with each refusal as `-- <location> <code> <message>` and a summary. Raw lowering by default; **`--prepared`** shows the program a backend receives, headed `preparation: backend=<b> provider=<p>`, for `--backend` (default `c`). `--rc` implies `--prepared` |
| `stats` | what preparation did, as `key value` lines in a fixed order: functions, layouts, ops, refusals, specialized values, removed and kept checks, calls by kind, and the counting and region figures under `--rc` |
| `regions` | under `--rc`, which calls a region could serve and the first reason each other candidate cannot, ranked, then every site and allocation placement |
| `expect-ir` | checks the `// expect-ir:` facts in the project's own sources against the program each named backend receives: one `PASS` line per fact that holds, `FAIL` or `UNRESOLVED` per backend where it does not. Exit 1 if any fails, or if there are none |
| `facts` | per function, each numeric value's representation (`i32`, `i64` or `f64`), its range and flags (`whole`, `nan?`, `-0?`). `--prepared` for the prepared program; `--obligations` for every store into a written scalar type and whether it is proved (`--tsv` for tools); `--strict` for the strict check's errors and their count |
| `refusals` | one line per refused function of the prepared program, `name<TAB>reason` |
| `layouts` | every object layout: its name and type ids, the interfaces it implements, its base, its fields with their types and its methods; what an addon would publish; `BROKEN` where a base is not a prefix of its subclass |
| `modules` | the module graph and its evaluation order |
| `erasure` | what the program does with its `any` and `unknown` values, by declaration kind, beside a per-site control; `--sites` lists each site |
| `receivers` | every field access, by what its receiver is typed as, per file; `--sites` lists each |

## Other

- **`nts version`** prints the version, the semantic snapshot's schema
  version, the frontend's tsrs version and commit, the TypeScript commit, each
  local tsrs patch with its digest, and the binary's path and link time (epoch
  seconds: below a commit's time means the binary predates the commit).
- **`nts help`** prints the usage.

## Environment

| variable | read by | effect |
|---|---|---|
| `NTS_CHECKERS` | every compiling command | the checker pool's size, 1 to 256 |
| `NTS_NO_ACQUIRE` | every compiling command | `1` skips dependency acquisition |
| `NTS_BACKEND` | `check` | the backend: `c`, `llvm`, `jvm` or `wasm`; an unknown name is an error |
| `NTS_RC` | `check` | `1` counts references |
| `NTS_NODE` | anything that reads `nts.config.ts` | the node that evaluates the config; default `node` |
| `CC` | `build` | the C compiler command line, such as `zig cc`; default `clang`. ThinLTO only when it is clang |
| `NTS_BIND_CC` | `bind-c`, `build` | the compiler that parses headers; else `CC`, else `clang` |
| `ANDROID_HOME`, `ANDROID_SDK_ROOT` | `build` | the Android SDK; default `~/Android/Sdk`. Set and not a directory is an error |
| `GRADLE_USER_HOME` | `build` | the Gradle cache searched for pinned jars |
| `NTS_APPLE_ROOT`, `NTS_APPLE_SDK`, `NTS_IOS_SIMULATOR_SDK` | `build`, `bind-objc` | Apple sysroots and libuv; default root `~/.cache/nts/apple` |
| `NTS_WINDOWS_ROOT` | `build` | Windows libuv per architecture; default `~/.cache/nts/windows` |
| `NTS_TYPES_ROOT` | every compiling command | the store of generated platform surfaces; default `~/.cache/nts/types` |
| `NTS_NAPI_INCLUDE` | `build` | the Node-API headers an addon compiles against |

## Decisions

- **Shipped native programs count references;** never-freeing is for tests
  only, which is why `nts build` counts by default
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- **Benchmarks build exactly as `nts build` does, and `nts build` uses
  ThinLTO** ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
- **A missing builtin is `NTS1100`, "not on this target",** checked per target
  against one full lib ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22),
  decision 11).
