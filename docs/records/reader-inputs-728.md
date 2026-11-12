# Reader declarations: #728 census and slices

This is a classification and implementation proposal, not a change to the
current selector contract. No production reader or verdict changed in this
slice. The task remains open.

The fixed source pin is `08852c508f035ff4e946eb91e36dd180ace498ec`. The source
tree was read only. Instrumentation ran in a temporary staged selector copy,
which was removed afterward. The copy never ran Git against its own directory;
repository reads used the selected pool tree. Node was v26.13.0.

## Cause and inventory

Simply switching off TypeScript/JavaScript module-text inference loses
295,865 (path, step) edges. Preserving parsed module closures when shell or
Python names a JavaScript entry retains 743 of those edges. That handoff is
AST-based and stays. Its inferred shell origin remains additive: following
the entry's imports does not give inferred text authority to discharge the
full-gate fallback.

The resulting switch-off census loses 295,122 edges over 24,942 paths. Every
edge has provenance. Following that provenance back to the first reader that
is still reached without module text reduces the review to 621 sites in 175
modules. This avoids classifying thousands of downstream strings as separate
root causes.

| First-loss role | Sites | Meaning |
| --- | ---: | --- |
| Reader | 196 | Reads, enumerates, compiles, runs or checks freshness of repository inputs |
| Data | 348 | Private fixtures, expected text, aliases, tables, enum values, diagnostics or outputs |
| Project context | 50 | A basename guessed beside a module; resolve it at the actual compiling reader |
| Existing import | 2 | Product imports already declared in source; preserve their compiler-reader context |
| Generator provenance | 25 | A generated-output comment names its producer; it owes freshness, not output execution |

The distinct-edge accounting assigns 229,716 edges to preservation or project
resolution, 65,403 to retirement, and three to generator freshness. The first
number is a conservative work budget, **not a claim that every guessed project
edge is a real input**. A row with any reader/project-context route remains in
that budget even when it also has data-only routes. The TSV records the reason
for each first-loss classification. These rows are evidence, not selector
exceptions or a hand-maintained input list.

Examples explain the broad reach. `typescript-record.ts` validates the prefix
`tests/typescript/`; validation does not read that directory. The migrate table
and host-owner tables contain path data. `oracle-execution.ts` uses a benchmark
prefix to choose policy. A command printed in a diagnostic is advice, not an
execution edge. In contrast, the JVM launcher audit reads real shell files,
the heap-layout control compiles its real C helper, and the oracle runtime
loads and hashes its execution assets.

The fallback ratchet does not rise even in the switch-off experiment:

| Census | Tracked | Full | Unplaced fallback | Explicit full policy |
| --- | ---: | ---: | ---: | ---: |
| Current selector | 28,478 | 182 | 149 | 33 |
| Module text off, shell/Python handoff retained | 28,478 | 182 | 149 | 33 |

This proves placement authority stays separate from additive reach. It does
not justify deleting real-reader edges before their declarations exist.

## Fixture-owned data

The existing module copier stages the same declared closure the selector
uses. Corpus declarations would therefore stage real data in fixtures unless
data ownership is explicit. The measured tracked populations are:

| Directory | Files | Bytes |
| --- | ---: | ---: |
| `tests/typescript` | 12,190 | 29,349,858 |
| `tests/programs` | 2,221 | 2,907,150 |
| `benchmarks/cases` | 1,124 | 48,208,998 |

The proposed graph distinguishes executable module membership from explicitly
declared data directories. A small identity/brand owner marks a module-relative
directory URL as data. Ordinary entries, imports and URL-declared modules keep
their production ownership. The brand changes neither the directory's path
nor its production bytes; its declaration is visible to the shared parser.
Existing unbranded module-directory semantics stay intact.

The copier accepts a fixture-owned replacement only for such a declared data
directory. Its manifest names the declaring reader, repository-relative data
namespace and fixture-owned replacement. Substitution does not create module
reach or placement authority. Private fixture names remain relative in the
manifest. No new list of imports or module dependencies is accepted.

| Required rule | Control |
| --- | --- |
| Only a production-declared data directory is substitutable | An undeclared namespace and an ordinary module directory are refused by name |
| Module files always come from production | An entry/import/URL module under the proposed namespace retains production bytes; conflicting private module bytes are refused |
| Each substitution is recorded | The staged manifest names the reader, namespace and private replacement, and excludes source-tree absolute paths |
| No substitution means a complete copy | Without a grant, every declared tracked data member is copied unchanged |

Additional controls keep directory grants from replacing a file, escaping the
fixture, or bypassing a production module through a symlink. Directory data
can include TypeScript corpus cases; those are data consumed by the compiler,
distinct from the host modules that implement the test instrument.

## Landing slices

Each slice says `Part of #728`; the final removal says `Fixes #728`. The first
two slices establish evidence and the copier capability without changing
reader declarations. Subsequent groups are ranked by distinct remaining
classified edges, with a deterministic first-owner assignment so overlaps
are not added twice.

| Slice | Scope | Expected classified-loss reduction | Classified losses left |
| --- | --- | ---: | ---: |
| Census and classification | This record, classified TSVs and reproducible edge-index digest | 0 | 295,122 |
| Data ownership and shell/Python handoff | Typed data directories, manifest and the four controls; parsed handoff remains additive | 0 against the corrected baseline | 295,122 |
| Test262 and TypeScript readers | Nine reader modules, twenty first-loss sites; real metadata and suite inputs, project-context resolution | 121,912 | 173,210 |
| Runtime, conformance and configuration readers | Nineteen modules, eighty-five sites; project trees, verifier inputs, real interop inputs | 67,447 | 105,763 |
| Benchmarks and oracle readers | Fourteen modules, fifty-five sites; corpus inputs, runtime assets and recipe budget freshness | 38,324 | 67,439 |
| Remaining tooling readers | Twenty-seven modules, fifty-five sites; fixture inputs, probes, bootstrap, licenses and shared helpers | 2,033 | 65,406 |
| Delete module-text inference | Retire 65,403 data-only edges and give the three producer edges their freshness check | 65,406 | 0 |

Those reductions are **disjoint accounting targets from this census**, not
measurements of unbuilt patches. A shared declaration can close another
group's route too. Each slice reruns the switch-off census, publishes its
actual delta and reassigns the remaining budget. It must lose no classified
real input and add no fallback path. The current reader lists and per-step
budgets are in the summary JSON. Tooling's large raw loss includes many
fixture/table false readers; after classification it is not the largest
remaining reader group.

The risk in each conversion is path semantics: roots, supplied fixture trees,
project discovery and runtime recipe identities. Reader conversions use their
declared URL as the input; they do not add unused declarations to mask a loss.
Project lookup remains with its existing owner. The oracle recipe conversion
reports budget refreshes and proves counts stay unchanged. Rust `embedded()`'s
coarse directory ownership remains separately visible; a single included file
must not silently become a claim over its neighbours.

The final controls compare a declared data file with the same path in fixture
text, a table, an alias and a diagnostic. Only the declaration contributes
reach and placement. Shell/Python-to-JavaScript imports remain covered, and an
unknown path retains the full fallback. Focused tests include selection,
the owning readers, timing, the host audit and strict types. Corpus and fixture
staging costs are checked before queueing, so isolation cannot imply copying
every real corpus into every private test.

## Retained evidence

- [Summary, per-step losses, slice budgets and fallback counts](reader-inputs-728/summary.json)
- [Reader classifications](reader-inputs-728/readers.tsv)
- [First-loss sites and reasons](reader-inputs-728/sites.tsv)
- [Exact reproduction](reader-inputs-728/reproduce.ts)

The lossless edge index is kept at `~/.cache/nts-scratch/728/edges.json`, outside
Git. `tooling/full-check/keep.json` retains that evidence directory until #728
closes. Its SHA-256 is
`0c409f453dee0c913ef9dcebadc2968a7361f295469f47f10c49dd37d64a5475`.
Recreate the fixed source and index from any pool tree carrying this record:

```sh
node tooling/agents/agents.ts start --name 728-reproduce -- \
  node tooling/gate/admit.ts --key tooling-tests --what '728 reproduce recorded edge index' -- \
  node docs/records/reader-inputs-728/reproduce.ts "$HOME/.cache/nts-scratch/728/reproduced"
```

`reproduce.ts` checks Node's recorded version, initializes an independent Git
repository in owned scratch with explicit private `GIT_DIR` and disabled
global/system configuration, and populates its index/files from the recorded
commit. Its alternate object store is read only; all refs and Git state are
private. It shares the provisioned parser packages, runs the retained census,
classification and encoder, and verifies the output digest before removing
the source copy and its private Git directory. The output index is
`~/.cache/nts-scratch/728/reproduced/edges.json`.

The edge index has path and step dictionaries, first-loss site rows and shared
frontier sets. Each edge stores dictionary indices for path, step, frontier set
and disposition. Decoding is checked against every original classified edge.
The source of each first loss is therefore retained without hundreds of
thousands of repeated reader/literal strings.

The retained `census.ts`, `frontiers.ts`, `classify.ts`, `plan.ts` and `index.ts` capture the
read-only investigation. `census.ts` requires a source tree at the named pin
and a separate output directory; the other scripts take that output directory.
They run through the normal admission/unit owners. The staged selector is
removed on completion. No reproduction creates or edits a shared worktree or
its Git configuration.
