# TypeScript

How nts is held to TypeScript. Two instruments answer different questions. The
**conformance suite**, `tests/typescript/`, asks whether a compiled program
behaves as TypeScript and node say it should. **TypeScript's own tests** ask
whether the compiler survives code nobody wrote for it. What nts compiles,
feature by feature, is the [feature table](../language/README.md); what it
declines on principle is [boundaries](../language/boundaries.md). For anyone
adding a case, reading a record, or changing what the gate's
`typescript-c`, `typescript-llvm`, `typescript-jvm` and `corpus` steps hold.

## The conformance suite

### What a case is

A case is one strict TypeScript file, `tests/typescript/<family>/<case>.ts`,
that checks itself through test262's harness (`assert.sameValue`,
`assert.throws` and the rest), under test262's front matter:

```ts
/*---
description: A numeric enum maps each value back to its member's name.
features: [ts-enum, ts-enum-reverse-mapping]
---*/
enum Color { Red, Green, Blue }
assert.sameValue(Color[Color.Green], "Green");
assert.sameValue(Color[2], "Blue");
```

- `features:` names the concepts the case exercises, as `ts-<concept>` tags.
  [`tests/typescript/FEATURES.md`](../../tests/typescript/FEATURES.md) is the
  vocabulary: one row per tag, what it means and where it comes from, and the
  families.
- The only flags are `module`, for a case that is module code, and `async`,
  for one that completes through `$DONE`.
- There are no negatives, since a program that must not compile is a
  `tests/refusals/` fixture, and no includes.

The concepts come from three sources: the directories of TypeScript's own
conformance tests (`tests/cases/conformance/`, read for concepts only);
typescript-eslint's TypeScript-only syntax nodes; and the typed paths, where a
static type steers how a value is represented. A concept with no effect while
the program runs has no case of its own, and appears where a value flows
through it. Each family has `combination-*` cases that pair its concept with
others.

A new case reuses a tag before adding one, and a new tag gets its row in
`FEATURES.md` in the commit of its first case.

### The oracle

The oracle uses these terms:

- A **governed** module or graph runs under the captured input contract below.
  Plain Node CommonJS executions are reported separately.
- A **capture**, or **captured tree**, is the run's recorded snapshot of source,
  configuration, package and runtime inputs and their filesystem observations.
- An **owner** is the nearest project configuration responsible for a source's
  checking and emission. An execution owner supervises one process tree and
  keeps its preparation until finalization.
- The **producer** prepares configured source graphs, their outputs and the
  evidence that binds each output to its source and owner.
- A **seal** is the parent's pinned identity for one Node version's validated
  dependency image, passed only within its run.
- The **holder** is the dedicated Node process that answers resolution queries
  and keeps that run's executable identity alive.
- **Holds by name** means reporting a specific instrument failure and leaving
  the execution unmeasured until that failure is resolved.

TypeScript's own emitter defines the expected result, and Node runs it. The
single-file case suite transforms its strict harness and case with the pinned
`transpileModule` API, using the case's options and the shared emit-option
overrides. This creates no checking Program. Node's execution decides whether
the case runs; nts separately checks and compiles its TypeScript.

The `typescript-oracles` step measures one Node answer per recorded case and
shares it with the C, LLVM and JVM steps. Each admitted case releases its
executable snapshot after finalization. Original inputs and an authenticated
result remain owned by the run, and each consumer replays the recorded input
observations, including failed lookups and directory listings. A missing or
changed reference holds by name. Samples select the named population first;
omitted records are not missing, and selected unrecorded cases stay pending.

Project graphs also use standalone `transpileModule` emission. Module format
comes from the source extension and the captured package's `type`, without a
checker. Projects requiring type-directed emission use the Program producer;
the named policy and its corpus guard live in `program-oracles.ts`. The source
graph records configured roots and resolved imports, without claiming a
checking certificate. Both producers emit into scratch at
`ORACLE_RUNTIME_TARGET`, ES2026. Node runs the captured
JavaScript, using source-map coordinates when available. Where Node's type
stripping and TypeScript's emitter differ, the emitter defines the answer: for
example, it writes a `-0` enum initializer as `0`, while a plain negative-zero
expression keeps its sign.

The `program-oracles` step publishes one completed answer per program for the
example arms and outcomes. A small warm worker pool recycles after a bounded
number of cases, and drains before native execution begins. Consumers retain
no SDK or preparation heaps. They authenticate the answer and replay every
recorded original observation on use. A native refusal may require another
execution of a selected case window: that uses the producer's authenticated
JavaScript image, with the ordinary byte, domain and finalization checks, and
does not start an SDK. Answers and replay images belong only to this run.

The target is one constant shared by supported Node 24 and 26. The permanent
syntax controls in `tooling/differential/oracle-emit.test.ts` run the emitted
decorators, resource declarations and RegExp modifiers on each version. The
pinned compiler rejects RegExp pattern modifiers at ES2024 with TS18062; both
supported Nodes run the ES2026 output. The target names the pinned compiler's
finite syntax transformation. A change to the TypeScript pin or supported Node
set must revisit these controls deliberately.

The oracle identity binds the emit entry, loader, exact TypeScript version and
package bytes; upgrading TypeScript requires the corpus-wide oracle migration
check again. The compiler carries the oracle assets and writes them to run
scratch. The canonical environment supplies the TypeScript toolchain location
through `NTS_ORACLE_TYPESCRIPT`; every file in the root and platform packages,
including the executable and declaration libraries, must match the recorded
hashes. There is no application-installed or global compiler fallback.

A run-scoped worker captures the verified toolchain once. Each project's
nearest `tsconfig.json` owns its ordinary roots, checking and resolution. A
requested TypeScript entry that is not an ordinary root of that project holds
by name; an imported file does not become an ordinary root merely because the
harness requests it. Referenced projects resolve to their sources, without
reading, copying or writing project build outputs. Each imported ordinary
source keeps its nearest project owner, including nested projects. Only the
requested import closure is published for execution. Each owner emits with its own options into a shared
tree that preserves the relative positions of sources across owners.
Runtime capture follows that import and package closure. An owner's directory
does not add its unrelated siblings to the capture; omitted paths remain
unknown. Explicit runtime inputs name the additional files or trees a harness
needs.

Each owner's configuration changes only its output locations: `outDir`,
`declarationDir` and `tsBuildInfoFile` point into the shared tree. Its roots
and semantic options stay as configured. Every overlaid configuration is
subject to the rule below for a configuration that is also a program input.

When type-directed emission is required, the complete owner program supplies
checking context. The following checking and diagnostic requirements apply to
that Program producer. The pinned public TypeScript API creates two programs per project. The
configured checking program decides admission with `--noEmit` semantics. Its
request filesystem supplies the original parsed configuration with only
`compilerOptions.noEmit` set to `true`; the original and overlaid bytes and the
changed key are bound in the preparation. A configuration parse error holds. If
that configuration is also a program input, such as an imported JSON module,
preparation holds because checking intent would change source data. All other
reads come from the captured originals.

The emission program uses the same ordinary roots and source-resolved inputs.
The checking program's loaded implicit library files, including their wrapper,
are explicit emission inputs, so the emit target cannot select different
libraries. Before publication, its complete file set, resolved import edges and
checking diagnostics must agree with the checking program, apart from the exact
TS2877 obligations described below. Each program input
joins the exact bytes served at its read callback, or the exact immutable
toolchain inventory. The parser's own text never stands in for those bytes.
Emission also requires no compiler diagnostics other than the accepted TS2877
obligations described below, `emitSkipped: false`, and a source owner for every
executable output. A missing, foreign or ambiguous owner holds by name.

The emitter's fixed `ORACLE_EMIT_OPTIONS` list
(`tooling/differential/oracle-emit.ts`) names every override and its reason:

- runtime syntax: `target` is the one pinned finite standard; `module` and
  `useDefineForClassFields` carry their explicit values or effective defaults
  from the owner, and `lib` preserves its already captured library inputs;
- placement: `outDir`, `rootDir`, `declarationDir` and `tsBuildInfoFile` keep
  output in the run's namespace while preserving the original root constraint;
- program output: `composite` is off for source-resolved emission, with the
  original declaration requirement preserved by `declaration`;
- writing: `noEmit` and `emitDeclarationOnly` are off so Node receives
  JavaScript;
- diagnostic obligations: `noEmitOnError` is off, so an import that TS2877
  reports still produces the output that proves its route; checking and
  emission diagnostics are still gated before publication.
- rewriting: `rewriteRelativeImportExtensions` makes emitted relative imports
  name emitted JavaScript.

Source maps follow the owner's configured `sourceMap`, `inlineSourceMap` and
`inlineSources` options. The oracle adds no maps. An authored map URL is kept as
written; Node decides whether the selected map supplies stack coordinates.

The pinned target changes syntax while the owner keeps its module, decorator,
JSX and class-field semantics. Its target-dependent defaults are carried
explicitly. A permanent comparison pins those defaults to the public compiler
for every accepted target and the unspecified case. Module resolution stays
configured. Complete diagnostic parity controls pin the original root
constraints, type lookup and map options against stock `--project --noEmit`.
A non-relative TypeScript specifier that cannot be rewritten may produce TS2877
in the emission program. The diagnostic stays in the evidence; it is accepted,
never removed. It is accepted only when the importer, the specifier and its
position, the source bytes and the target the checker chose all match one
record from the producer, and the target's own project publishes that target's
exact output. The preparation and the loader each check that record. A
specifier written more than once shares one runtime route only when every
occurrence names the same target, owner and output. Any other diagnostic or
unowned target holds by name.

Within a registered run, an owner's emission is reused only for the same owner,
configuration and inputs. Every reuse replays all recorded observations through
the adapter, including failed lookups and directory reads. A changed input
means a new emission, and nothing is reused after the run ends. Checking an
owner's whole program, and the TS2877 obligations it defers, never add that
owner's other roots to what is published.

The outcomes preload recognises a runtime binding module by mapping its emitted
file back to its source through the producer's record, never by the emitted
file's extension. Its assets come from the captured namespace: a file the
capture holds is used, a file it proved absent is not injected, and a file it
never looked up holds by name.
The preload declares its binding-file rule to preparation. Only reached runtime
sources select companion files, and preparation records their exact presence
or absence through the same rule the preload uses.

A manifest is published only after every bounded project result and output has
been validated, and the owner keeps the preparation until consumers finish. An
incomplete compiler command or an invalid result is unmeasured, never a
completed TypeScript rejection. `nts check` accepts an explicit prepared
manifest, verifies its implementation and current request identity, and
otherwise prepares its singleton. The application loader reads completed
JavaScript without importing the emitter. An undeclared TypeScript load is a
sticky instrument failure, even if application code catches it. A completed Node
rejection is recorded as `oracle-rejected` and reported as `no-verdict`, with
Node's error and exit status. It counts neither for nor against nts. A new
rejection is a record delta that fails comparison until reviewed. An async case
passes by its completion line; an explicit async failure is a rejection even
when Node exits zero.

The Node harness derives its finite preload and sibling roots from the same
planner its runtime consumes. Its prepared identity binds that planner, harness,
declaration files, static shims and project options. Overlapping roots must emit
identical JavaScript, and Node's resolution from each captured context must
agree on the same target. The emitted inventory binds each source to its output
through the public producer's `sourceFileName` relation and the complete program
inventory. Source maps only present original coordinates; they never decide
which output belongs to which source. Each project runs from a captured tree
containing the emitted files, package scopes at their original relative
positions and runtime assets. A root scope without a type prevents
scratch-directory package metadata leaking into an otherwise unscoped program.
Dependency links target a run-owned, verified capture of exactly the install
inputs the pinned package manager reports: the root manifests and lockfile and
its importer directories. Each Node version owns a separate image. A canonical
run validates that image once and passes a version-specific seal pinned after
publication. Later acquisitions check the ready record's exact inode and stat
identity, including its unmodified ctime, without starting a helper process or
walking the image again. A declared but changed or invalid seal is a named
instrument hold, including through the gate and lander; a case-budget failure
keeps its verdict disposition. The seal belongs to its run and never outlives
its registered capture owner. Outside a canonical run, acquisitions retain
complete validation of the recorded commit and input paths.

A seal does not make the image immutable. Metadata is checked against the
parent's pinned hashes before use. Each preparation publishes one snapshot:
the complete original observations are validated before publication
and again when its owner finalizes, after every process and Worker has drained.
Finalization precedes any measured row, report or cleanup, including error and
early-return paths. A difference holds the whole session as an instrument
failure. Child readiness is provisional until that parent result exists;
skipping finalization holds, and no execution may start afterward.

Governed execution reads the published mirror. A small parent-bound descriptor
authenticates the index, its compact slot table and each bucket a child uses. A
child checks that chain and hashes the exact bytes it loads, including live
dependency package bytes; it replays no original observations. Generated
type-free loader assets belong only to the run root and are checked before
evaluation. Parent-only planning and capture code never loads in a child.

Node determines module format and resolution through its public hooks. A
dedicated process batches the preparation's queries without evaluating their
targets, and children replay its authenticated successful answers. The identity
binds the Node binary and all effective resolution options, including
conditions, symlink and module-type flags and NODE_OPTIONS. On Linux the holder
remains executing that binary; children check its process birth and executable
device and inode against their own. A replaced executable, dead holder or
different options holds by name.

Query and fragment identity are preserved. `import.meta.url`, `__filename` and
`__dirname` name emitted files and directories, as in plain Node on the emitted
tree. Source maps present coordinates only when Node selects one; otherwise
stacks retain emitted coordinates. Relative assets keep their source layout.
Within captured trees, the observation-only filesystem guard marks unobserved
reads and probes as sticky instrument failures, including caught errors, without
changing the operation or result. Absolute system reads pass through.
Conflicting outputs hold before publication, and owners declare output
namespaces before capture so generated files cannot become another preparation's
inputs.

Authored JavaScript CommonJS sites use their plain Node path. Each execution
names and hashes its authored inputs, Node decides their format, and the report
lists them separately as **plain node (outside capture)** with `attested:
false`. Those rows are neither captured reach nor captured passes. A transition
into TypeScript, ESM or provider code must have a captured owner; an unowned
transition is a named hold. A private harness capability delegates only exact
child inputs and its validated launch environment.

For governed graphs, one bound lookup-domain authority proves completeness
before Node is asked to resolve a request, for successful and failed resolution
alike. Unobserved paths are incomplete inputs, never assumed absent. Package
facts use canonical identities from the recorded link graph; `main` paths retain
the logical directory through which the package was requested. Facts belong to
their captured namespace, and overlapping owners must agree. A successful answer
requires an exact captured owner.

An unrecorded computed ESM request or an admitted absolute CommonJS request
takes a bounded live path. Its complete domain and required file, kind, package
and link facts are checked at that call, and Node's result or original error is
preserved. Unproved CommonJS routes, unsupported recipes and changed extension
registries hold by name. The generated sensitivity guard in
`tooling/differential/oracle-filesystem.test.ts` runs against both supported
Nodes. In its bounded layouts, every candidate whose decoy changes Node's answer
must be among an admitted request's claimed lookups.

One filesystem adapter records planning and checking reads, successful and
failed existence checks, directory listings and realpath answers. Config
discovery, inherited configs and package metadata remain inputs even when lookup
fails. Owner-emission reuse replays those observations through the adapter; the
complete preparation is checked at publication and finalization. Validators
replay filesystem operations, never a second resolution algorithm. Their counts
and costs are separate from verdicts. The differential project's tooling test
runs the pinned compiler over every `.ts` file in `tooling/differential`,
except the exclusions named in its configuration, and requires zero diagnostics.

Each application has a fresh append-only loader event stream shared with its
exactly delegated children. Writers own authenticated append descriptors opened
without following links. The supervisor retains a read descriptor to that same
stream from before launch, reads after the process tree drains and closes it on
every path. A parent reserves a child before launch; its authenticated bootstrap
records begin, then ready after validation. A parent may close a failed launch
only when no begin exists. Begin without ready holds. Unknown, malformed,
duplicate and unfinished reservations hold, as does any instrument event, even
if another child reports ready or the test catches an error or exit.

Worker delegation uses a closed producer-declared driver bound to captured
source bytes. Every realm gets a fresh reservation and private workerData
context, preserving the user's workerData value and environment, including an
empty environment. Root capability issuance is unchanged; test and provider code
gain no wrapper handle. A declared invalid handoff holds by name. Empty,
truncated or invalid event streams and missing ready events hold too. Missing
loader status, a signal, a timeout or missing async completion leaves the oracle
unmeasured; none can be recorded as an expected rejection or compiler result.

Families awaiting enrollment live in `tests/typescript-pending/`, which the
runner does not select: decorators, legacy decorators, `accessor` fields,
transform-divergence cases, modules, CommonJS interop and JSX. Each family's
README says which TypeScript emit options and fixture layout it needs to join
the suite. TypeScript's emitter supplies their oracle too.

### How a case is counted

The test262 runner runs the suite, `conformance262.ts --suite typescript`,
with test262's harness stand-in and layout, the case compiled as
`src/main.ts`. A case gets the same five outcomes as a test262 case, and a
refusal's causes are ranked the same way ([test262](test262.md#outcomes)).
Two things differ:

- nothing is excluded: a case is in scope by being written;
- the report adds a table by feature, one row per `features:` tag. A case
  carries several tags, so the rows overlap and do not sum.

### Records and the gate

A record is [`results/typescript/<backend>/cases.tsv`](../../results/typescript),
one each for `c`, `llvm` and `jvm`. Its first line is versioned JSON metadata:
the record's version, the backend, the compiler's commit and fingerprint, the
harness and the selection. Then every source case in the selection has one
row, its path and its observation as typed JSON:

| kind | what is pinned |
|---|---|
| `pass` | nothing more |
| `wrong` | the thrown class and the program's output, exactly |
| `refused` | the sorted set of diagnostic codes, each with where it points (`body`, `harness`, `other` or `none`) |
| `invalid-hir` | the validator's error |
| `runtime-abort` | the termination (exit status or signal) and the output, exactly; for a JVM host exception, its class and message line, its frames left to the raw rows |

A record pins what a case did, never how the compiler phrased or numbered it:

- a refusal's prose stays in the run's raw rows and is ranked in the report;
  a reworded message changes no outcome;
- generated numbering, such as instantiation and type ids (`Queue<N>`,
  `type N`), is normalized before anything is compared or written, by the
  normalizer the outcomes corpus shares;
- names and the case's own source positions are kept.

Before `--recorded` selects what to run, the record is checked against the
complete source inventory. A case with no row yet is pending: it is listed,
not run and not a failure, and the full check writes its row after landing
(`tooling/records/record-pending.ts`). A row whose case is gone fails the run.
Duplicate, orphaned and malformed rows fail closed, and a timeout or an
infrastructure failure is never recorded as an outcome.

The gate's `typescript-c`, `typescript-llvm` and `typescript-jvm` steps, core
steps, run every recorded case on their backend and compare it with that
backend's record under the transition policy the outcomes corpus shares,
which orders outcomes pass > refused > loud defect (invalid HIR, a runtime
abort, a build failure) > silent wrong answer, the last because nothing
reports it:

- a pass that does anything else, or any move down that order (a refusal to
  a defect, a loud defect to a wrong answer), is `REGRESSED`;
- a different defect of the same rank is `CHANGED`;
- either fails the step;
- a defect or refusal that now passes is `FIXED`, a defect that is now
  refused is `REFUSES NOW`, and a wrong answer that now stops loudly is
  `LOUD NOW`. All three pass, are listed as improved, and the full check
  rewrites their rows;
- a case refused before and after with a different set of refusal codes is
  `REFUSES DIFFERENTLY`: accepted, listed and rewritten the same way, because
  a refusal is safe whatever its reasons, and lifting one exposes the next.

There is no floor, because the record is the ratchet. The step needs the
test262 checkout, whose harness the cases assert with.

### Running it

`NTS_BIN` names the compiler; for evidence, a pin of a commit.

```sh
# As the gate does, one backend at a time
node tooling/census/conformance262.ts --suite typescript \
  --recorded results/typescript/c/cases.tsv

# Every case, or one family
node tooling/census/conformance262.ts --suite typescript
node tooling/census/conformance262.ts --suite typescript --under tests/typescript/generics

# Re-record, from a pin of a commit
NTS_BIN=$(node tooling/conformance/pin.ts <rev> | tail -1) \
  node tooling/census/conformance262.ts --suite typescript \
  --record results/typescript/c/cases.tsv

# Write only the pending and improved rows, as the full check does
NTS_BIN=<main's pin> node tooling/census/conformance262.ts --suite typescript \
  --record-pending results/typescript/c/cases.tsv
```

## TypeScript's own tests

### What runs

TypeScript's compiler test cases, `third_party/typescript/tsc/testdata/tests/cases`,
at the commit `TYPESCRIPT_PIN` names in
`tooling/suite/src/test262_runner/mod.rs`. That commit must be the one the
native checker ports, the `typescript_commit` of
`third_party/tsrs/UPSTREAM.json`: a unit test asserts it, and
`tooling/bootstrap/typescript.ts` refuses a mismatch when it checks the tests
out.

The landing population is the cases `tooling/suite/corpus-core.json` names.
A multi-file case (one with `// @filename:` directives) is skipped: compiled
as one file, it would be a concatenation nobody wrote. `--full` selects every
source case at the pin, a separate survey that no gate step runs.

`nts-suite` compiles each case as an ordinary program. The full survey runs
each compilation in a child process, so a crash is pinned to its file and the
run goes on.

### How a case is counted

| outcome | meaning |
|---|---|
| lowered completely | every construct in the file compiled |
| refused a construct | lowered in part, with each refusal named |
| rejected by the typechecker | usually the file's purpose: a compiler's test suite is mostly programs meant to fail |
| frontend failed | loading or capture failed: the compiler fell over, not the program |
| invalid HIR | lowering produced IR the verifier rejects |
| compiler crashed | the compiler's process died (the full survey's child processes) |
| uncompilable C | the emitted C does not compile |
| unverifiable class | the JVM rejects an emitted class file, checked where a JDK is installed |

The last five must stay at zero: they are the robustness this corpus measures.
It is not a correctness oracle, because these files are checked for types,
never for answers. Its refusal table counts how many files each refusal
stops, which ranks breadth rather than work: a file refused for three reasons
does not lower when one of them is fixed.

### The report and the gate

`nts-suite` writes its report, with the refusal table, to
[`results/suite/corpus.md`](../../results/suite/corpus.md). The
gate's `corpus` step, a core step, runs the landing population and fails if
the run does not finish, if any of the five rows is not zero, or if it
measured no case.

```sh
cargo run --release -p nts-suite              # the landing population
cargo run --release -p nts-suite -- --full    # the full survey
```

## Probing one construct

Whether a single construct compiles is answered by a probe. Write each use as
one exported function at the top level of a file, and run `nts hir` on its
project: lowering reports one diagnostic per function, so a file of thirty
functions answers thirty questions. Two traps:

- a file with a type error lowers nothing, and every row then reads as
  supported, so read the checker's diagnostics first;
- a declaration nested in a function body can be refused for being nested
  rather than for what it is, so probe at the top level.

`nts hir --prepared --backend <backend>` shows what a backend sees.

## Decisions

The single-file case suite uses pinned `transpileModule` and one run-owned
answer shared by the backends. Its parent input checks and captured-JavaScript
execution boundary remain mandatory. The
[case-producer decision](../records/notebooks/decisions-log.md#typescript-case-transform-and-shared-answer-11-07)
records this contract.

The oracle uses the pinned public TypeScript API to check and emit one
source-resolved program authority. Authored JavaScript CommonJS runs as plain
Node outside the capture claim; transitions back into governed code require
ownership. General CommonJS lookup proof requires a replay filesystem below
Node and is outside this oracle's scope. Pending families wait for enrollment
with their required emit options. The
[ownership decision](../records/notebooks/decisions-log.md#typescript-oracle-ownership-and-public-emit-11-04)
records this contract.

TypeScript's own emit defines the expected answer, including its folding of a
negative-zero enum initializer to positive zero. One pinned ES2026 target makes
the emitted syntax executable by every supported Node, while the owner's module
and class-field defaults and its original library inputs preserve the program's
configured semantics. Canonical runs validate dependency captures once and hand
down a run-owned, version-specific seal; actual-use checks remain mandatory, and
a changed seal holds by name. The
[emitter, target and seal decision](../records/notebooks/decisions-log.md#typescript-emitter-authority-runtime-target-and-run-seal-11-04)
records these choices.

The run owns a prepared snapshot whose original facts are checked at both ends.
Children authenticate the index and loaded bytes; Node-probed routes retain
Node's own resolution and format decisions. Source maps follow the owner's
options. Finalization is required before any verdict escapes, and incomplete
child or Worker bootstrap remains a named instrument hold. The
[snapshot lifetime and resolution decision](../records/notebooks/decisions-log.md#oracle-snapshots-and-node-resolution-11-05)
records that boundary.

