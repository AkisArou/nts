# Native syntax capture audit

The migration audit at `9337123d4` parses the original sources under the same
isolated options in the current Go 7.0 frontend and tsrs 0.19.0 (TypeScript
`3e9236361`). It compares corresponding nodes by their structural child path,
not checker identities. The manual `real_corpus_syntax_audit` unit writes both
arenas; the comparison report lives under
`~/.cache/nts-scratch/tsrs-lane/syntax-corpus-audit/`.

| Source | Go arena | Native arena | Reachable nodes compared |
| --- | ---: | ---: | ---: |
| `tests/programs/a-method-through-a-union-of-classes/src/main.ts` | 473 | 452 | 452 |
| `runtime/node/readline/src/interface.ts` | 8,079 | 7,907 | 7,907 |
| `runtime/react/compiler/fixtures/host-components/app.tsx` | 107 | 107 | 107 |

All 8,466 nodes have matching child counts, child order and declaration
modifiers. One syntax kind changes. No children disappear from the reachable
tree. The smaller native arenas omit detached documentation subtrees.

## The TypeScript change

`OutputStream extends StringWritable` in readline uses a TypeReference (nts
tag 184), where 7.0 used ExpressionWithTypeArguments (234). TypeScript
`3e9236361`'s `tsc/internal/parser/parser.go::parseTypeHeritageClauseElement`
explicitly converts valid interface-extends and class-implements names to
TypeReference. The native parser ports the same conversion. The builder
retains that shape.

Consumers: interface hierarchy uses `base_types`; class-implements reads each
heritage target's node type; inhabitance walks descendant symbols; native
bindings walk the target's first child. These work for both shapes. Receivers
and layouts consume the semantic type graph. React already handles
TypeReference in `convert/types.rs`; its expression-only heritage reader is
for a class's extends clause, whose syntax does not change. The interface's
erased extends clause is currently omitted by that converter in both paths.
`an-interface-heritage-type-keeps-structural-dispatch` exercises inherited
dispatch with a directly-declared control and distinct concrete layouts.

## Projection differences

These describe the nts capture, rather than a tsrs checker divergence.

| Difference | Consumer and disposition |
| --- | --- |
| 539 initial list starts included trivia (corrected) | Source locations and React source slicing consume spans. Capture now uses the native scanner's `List::token_start`, including empty lists after a comment. The repeated audit has zero span differences. |
| Detached JSDoc subtrees omitted (21 program, 172 readline nodes) | No consumer reads detached documentation nodes. The old decoder already removes their top-level child edge. nts and JVM tags use leading raw documentation through `annotations`; file-level tags use the original file text. React's comment collector scans raw source and its `jsdoc_children` sees no detached child in the old path either. Checker-only JSDoc signatures remain native checker facts. |
| Binder/parser context flags omitted | Consumer: none for ContainsThis, return reachability, await/disallow-in context and HasJSDoc bits. Capture retains ambient and optional-chain facts; declaration modifiers match exactly. |
| Combined var/let/const facts also appear on individual declarations | Lowering and React read the declaration-list's kind, which matches. The extra per-declaration fact is unused. |
| SourceFile now has an explicit two-slot presence mask | Consumer: shared child lookup. The old root had Flags but both real children already existed. Explicit slots preserve children and make the root's layout truthful. |
| Childless tokens use Flags instead of Children with presence zero | Consumer: none distinguishes these forms for tokens. Both carry the same per-kind flags and have no child slots. |
| Block/array multiline small bit omitted | Consumer: none; this is formatting metadata. |
| JSX-text whitespace-only small bit omitted | Consumer: none; React reads and decodes the original JSX text. |
| Cooked string values and raw regular expressions retained where Go text was absent | String consumers gain the actual cooked value; React cooks strings from source. React reads regular-expression source spelling; core refuses regular-expression literals. No existing text value changes. |

There are no differing spans on real syntax nodes, no changed existing text
values, and no unclassified syntax kind or child-layout difference in this
sample. After the list token-start correction, all 8,466 spans match.

## Known defect of the removed snapshot cache

The old Go producer's persistent cache hashes captured source files and the
config chain, plus a recursive source listing under the config directory.
It does not record failed resolution lookups outside that directory.

Reproduction: `app/main.ts` imports `../shared/index.js` while
`shared/index.ts` is absent. The first snapshot reports TS2307. After adding
the sibling source, the cached run still reports TS2307 and announces reuse;
with `NTS_NO_SNAPSHOT_CACHE=1`, the same compiler immediately captures two
files with no missing-module diagnostic. The captured old binary is SHA256
`7dd2a2caba63d4b2…`, frontend SHA256 `4878b658b2b2792b…`; evidence is
`~/.cache/nts-scratch/tsrs-lane/cache-negative-probe/results.json`.

This path is deleted rather than repaired. Native reuse must replay every
native host observation, including failures, through the adapter. Its tests
cover both a missing sibling source appearing and a new `shared/x.ts` taking
precedence over `shared/x/index.ts` for an import from `shared/use.ts`, also
outside the app config directory. Per-revision observation groups retain
the original physical reads before rewritten overlays; a final cached
overlay alone cannot validate the original source. The outer key separately
covers the actual request, native session identity, and nts plugin identities.

## Removed instruments and transport

The switch removes the Go subprocess, RPC client and AST decoder, the Go
patches and gitlink, bootstrap's Go build, external-frontend environment
selection, the single-implementation producer trait, and the old persistent
cache. The native snapshot builder asks the safe adapter directly. Its one
capture policy keeps library and provided types opaque while following the
call contracts a reached program requires.

`tooling/census/any-arrivals.ts` is removed with its JavaScript Go API driver.
It classified where an `any` parameter's value came from: direct concrete
calls, another `any`, escaping functions, uncalled functions, and other roots.
Its `--passes` arm was the pre-mortem over programs already passing. Its only
consumer was the paused `any` representation work. When that work resumes,
the instrument becomes an nts subcommand over the native snapshot.

## Upstream source readers

React's entity generator reads vendored `jsxtransforms/jsx.rs`. The sorted
entity payload is byte-identical; only the generated origin comment changes.
The old React Go child-layout generator is deleted: semantic-schema owns the
one nts slot table used by capture, lowering and React.

Chromium's DOM census reads `tsrs_vfs/libs/lib.dom.d.ts`. Running the previous
reader and migrated reader against this same input produces the identical
serialized coverage payload (86,938 JSON characters, excluding the source-path
metadata). The source change itself is TypeScript 7.0 to 7.1: the nine rows
below have net seven additional entries. The 2,027 literal-member declarations
are identical, so the existing Blink literal proof inputs stay unchanged.

| Coverage row | TypeScript 7.1 declaration change | Coverage effect |
| --- | --- | --- |
| `Element.setHTML` | Adds `setHTML(html: string, options?: SetHTMLOptions): void` | Bound |
| `CanvasRenderingContext2D.lang` | Adds `lang: string` to `CanvasTextDrawingStyles` | Bound |
| `SVGFilterElement.href` | Removes `SVGURIReference` from `SVGFilterElement`'s bases | Removed from this interface's coverage |
| `HTMLInputElement.colorSpace` | Adds `colorSpace: string` | Skipped: Blink's InputTypeColorEnhancements runtime feature |
| `Window.documentPictureInPicture` | Adds the readonly `DocumentPictureInPicture` property | Skipped: modules component outside this allowlist |
| `Navigator.serial` | Adds the readonly `Serial` property | Skipped: modules component outside this allowlist |
| `HTMLMediaElement.captureStream` | Adds `captureStream(): MediaStream` | Skipped: modules component outside this allowlist |
| `HTMLAreaElement.hreflang` | Adds `hreflang: string` to `HyperlinkElementUtils` | Skipped: Blink's HTMLAreaHreflangType test feature |
| `HTMLAreaElement.type` | Adds `type: string` to `HyperlinkElementUtils` | Skipped: Blink's HTMLAreaHreflangType test feature |

The checked-in Chromium/interop TypeScript programs use none of the six newly
skipped members (generated declarations and node_modules excluded). Totals
move from 3,155 bound / 233 skipped to 3,156 bound / 239 skipped; every other
coverage category is unchanged. These are upstream declaration changes,
not a new native binding claim.

## Lossless constant boundary

The old frontend replaced one lone surrogate with three U+FFFD characters.
`JsText` now carries either valid UTF-8 or exact UTF-16 units. Syntax cooked
text, literal and constant values, HIR `ConstString`, and template cooked
segments all use that same representation; raw template spelling remains
UTF-8 source text.

| Boundary | Representation |
| --- | --- |
| C and LLVM literal tables | Exact raw units determine width, payload, length and the shared precomputed hash; the terminator is excluded from hashing. |
| JVM constant pool | Modified UTF-8 encodes every raw UTF-16 unit, including an unpaired surrogate; class/member names still require UTF-8. |
| Wasm string constants | UTF-8 uses importedStringConstants. UTF-16-only constants use immutable externref imports from `nts:literal/v1`, with deterministic first-use ordinals and an explicit Manifest map the host must supply. |
| Node-API error codes | Exact units through `napi_create_string_utf16`; property and native symbol names remain ordinary UTF-8 names. |
| GTK GTypeName and template metadata | Named refusal for unpaired units, because the platform accepts only UTF-8 metadata. |
| Filesystem module specifiers and semantic names | Explicit UTF-8 projection; an unrepresentable required name is a named refusal. Identifier grammar cannot produce an unpaired unit. |

The new `a-string-literal-keeps-a-lone-code-unit` program compares written
high/low-surrogate constants with `fromCharCode` controls, embedded NUL,
valid pairs, and a tagged template's cooked value against raw source spelling.
At historical integration `df115abc2673`, every arm compiles and all 232 cases
agree on C, LLVM, JVM and Wasm; the old compiler disagrees. The paired corpus
at that commit is 730 unchanged / 1 fixed / 0 regressed on every backend.
These figures describe that commit; the final series requires a fresh paired
run against the main it is based on.

## Project diagnostics and emission

nts reports tsc's option and global diagnostics, checked as `tsc --noEmit`;
emit-only option conflicts do not reject a project. The deleted frontend asked
only for per-file syntactic and semantic diagnostics and never surfaced these
program diagnostics. The adapter forces `noEmit` because nts owns emission.
A fresh paired audit of 805 configurations found identical diagnostic vectors
(802 already had effective `noEmit: true`, three had false). Positive controls
remove TS5096 and the emit-only TS2441 while retaining TS2322.

`nts frontend` has an explicit exit contract: 0 for a clean capture, 2 for a
completed capture with checker errors, and 1 for failure to capture. A typed
CLI error carries the distinction; tools do not infer completion from message
wording. The semantic-code audit accepts only 0 and 2. Its other callers are
the case-root determinism tests (0/2), the WinMD positive/negative checker
control (0/2), and the generated-GIR build control (0). The case-root test no
longer passes the removed Go query flags. The conformance runner and attempt
workers invoke emission commands rather than `frontend`.

`check` and `emit-*` retain their existing convention: checker rejection is a
general failure with status 1, while named partial-compilation refusals keep
their existing handling. A common diagnostic exit convention across commands
is a follow-up, outside this switch.

## Demand-driven generic return capture

The native capture originally expanded every declared generic return. Array's
uninstantiated `flat` signature led through `FlatArray<Arr, Depth>` to an
unbounded sequence of new conditional instantiations while `Depth` remained a
type parameter. This was a capture-policy defect, with no adapter or vendor
change needed. Generic signatures now record a shallow, reopenable return;
actual reached call contracts explicitly request their instantiated returns.
Deferred generic forms are marked expanded only after their eligible pass.

The unchanged complete-contract guard reports zero missing reachable type
slots over the program corpus. The standing runtime guard captures every
`runtime/node/*/tsconfig.json` and `runtime/web-platform` config used by
`integrity --runtime`, plus the React reconciler: no NTS0003 and a recorded to
frontend-seed ratio below 4. Array.flat is a capture fixture (19 types), since
executing it is refused on both compiler paths. The user recursive generic's
scalar instantiations at depths 1 and 2 execute with a non-recursive control.

### Comparable recorded type counts

These are production capture facts, **not timing measurements**, from Go
`ff8cceb3dbf941973fb3cabb95514924a5ca4ff1` and native `c4225605a`. The `types`
command enables Go decomposition and call resolution through `for_compilation`.
Raw evidence is `native-repair-c4225605a/{fs,reconciler}-{before,after}.types`
in the lane scratch directory. Native fs is complete at 21,940 records and
15,238 export-reachable types (15,414 frontend seeds). Reconciler has 5,206
records, 4,536 export-reachable types and 4,761 frontend seeds, with the same
170 checker errors as the old diagnostic workload.

The earlier saved Go `frontend` rows (14,858 fs / 4,632 reconciler types) omitted
`--decompose --calls`. They describe a different capture mode. Their Go/native
performance ratios and the inferred “extra 7k types” are withdrawn.

| Kind | Go fs | Native fs | Go reconciler | Native reconciler |
| --- | ---: | ---: | ---: | ---: |
| Any | 2 | 2 | 76 | 76 |
| Array | 309 | 273 | 85 | 85 |
| BigInt | 1 | 1 | 1 | 1 |
| Boolean | 2 | 2 | 2 | 2 |
| Conditional | 155 | 155 | 22 | 22 |
| Evolving | 1 | 1 | 1 | 1 |
| Function | 9497 | 8926 | 2355 | 2361 |
| IndexedAccess | 65 | 65 | 0 | 0 |
| Intersection | 284 | 284 | 7 | 7 |
| Literal | 3147 | 3147 | 1057 | 1057 |
| Never | 2 | 2 | 2 | 2 |
| NonPrimitive | 0 | 1 | 0 | 1 |
| Null | 1 | 1 | 1 | 1 |
| Number | 1 | 1 | 1 | 1 |
| Object | 3539 | 3275 | 643 | 643 |
| String | 1 | 1 | 1 | 1 |
| Structured | 1640 | 757 | 97 | 61 |
| Symbol | 1 | 1 | 1 | 1 |
| Tuple | 367 | 361 | 94 | 94 |
| TypeParameter | 1080 | 1084 | 206 | 207 |
| Undefined | 3 | 3 | 2 | 2 |
| Union | 3199 | 2896 | 546 | 546 |
| UniqueSymbol | 0 | 111 | 0 | 10 |
| Unknown | 1 | 1 | 1 | 1 |
| Unsupported | 0 | 588 | 0 | 22 |
| Void | 1 | 1 | 1 | 1 |
| Total | 23299 | 21940 | 5202 | 5206 |

Of fs's 588 Unsupported records, 571 are unrequested continuations at the
three-level deferred generic-form boundary; 9 are named unsupported
Substitution facts and 8 are named native types outside the semantic model.
The 571 continuations are interned when the last expanded form records its
member, union, type-argument and signature edges. All retain an incoming arena
edge, but no reached compiler contract requests their expansion. Removing them
would require stopping those parent edges earlier or compacting and remapping
the arena. That is a size optimization, not permission to expand another
recursive closure. The corpus guard rejects such a placeholder if any real
contract reaches it.

## Exact property-key construction audit

The literal audit scans `PropertyKey::Name` throughout compiler, tooling and
runtime, including method references such as `.map(PropertyKey::Name)`. At
`5fa5e5e90` its 51 sites comprise 31 production constructors, 12 test
constructors and 8 patterns. Patterns in C, Node-API, member-key display and
the schema preserve the typed key; they construct no Name from text.
The constructors have these sources:

| Site | String provenance and decision |
| --- | --- |
| `MemberKey::named` | Explicit public builtin method names such as next, valueOf and toString. Semantic member dispatch uses MemberKey::method with its existing key. |
| `Layout::index_of` | Public name lookup convenience; source member readers use index_of_key. Native ABI/tuple/error metadata intentionally supplies public names. |
| `member_key` constructor arm | The nts constructor key is an explicit public synthetic name. |
| `property_key` Name arm | AST identifier, string or numeric name. The preceding private-identifier arm constructs Private; computed names delegate to expression_key. |
| `expression_key` Name arm | A constant public property name, after the UniqueSymbol type test has returned the exact Symbol TypeId. A shorthand variable's value does not decide its written property name. |
| `property_name` shorthand arm | The shorthand's identifier spelling: `{ key }` declares the public string property "key", including when the variable's value is a unique symbol. Computed properties take the exact-key arm instead. |
| `access_key` non-access fallback | Public synthetic or binding-pattern name supplied by the caller; actual property and element accesses take their AST key. |
| `decide_object_columns`, JSON own fields | Public enumeration projects public_name first. Symbols and private fields are excluded by enumeration semantics. |
| `decide_has_own`, `presence_bit_named`, `in_by_presence` | A literal string key; a computed symbol is refused by these existing paths. Private-brand arms of lower_in_over_every_class, in_over_a_structural_arm and arms_declaring explicitly construct Private. |
| `protocol_walk`, iterator_close, printed edges, JSON toJSON, conversion_member | Closed ECMAScript public names (next, return, toString, toJSON, valueOf). Well-known symbol protocols compare the separate TypeId map. |
| `absent_member` | Diagnostic-only public fallback; real access keys are read from the AST before asking for a property type. |
| `capture::intern_symbol` provisional slot | An empty Name reserves a symbol's arena slot before recursive identities are followed; the adapter's typed name replaces it before capture finishes. |
| `capture::intern_symbol` Name pattern | Existing SymbolRecord public-name text passes workspace-prefix normalization. This pattern constructs no key and does not convert Private or Symbol. |
| `capture::property_key` Plain and Internal arms | Plain is the adapter's public name, required to be UTF-8. Internal is a closed typed internal-name projection; an unknown internal name is a named refusal. Private and Keyed have their own exact variants. |
| `SemanticSnapshot::key_is_well_known` | Pattern only: Name and Private are false, while Symbol compares the TypeId against the well-known-symbol map. |
| Test constructors | Explicit public fixtures and collision controls; the cycle oracle's private field now constructs Private explicitly. |

The shared private layout lookup was an observable migration defect. The
`exact-keys-through-member-reads` fixture is clean on main, refused on the
pre-audit native candidate, and has a public-name control differing only by
namespace. The private initialization proof likewise has its existing
PrivateReadFirst unit control. Erased cast reads/destructuring, derived
array/view method lookup, optional-method identity, getter absence reads and
narrowed/shared/open layout helpers now pass existing keys instead of
reconstructing them. These had no claimed pre-audit execution failure beyond
the shared-layout regression.

The audit itself introduced another defect: getter absence reads switched
from native schema lookup, which walks intersection parts, to an Object-only
interface lookup. The nullable contract was present in the snapshot, but a
`Class<Tag> & Methods` receiver lost it at lookup. The existing LLVM native
getter guard then reached `nts_concat` with NULL and crashed (confirmed by
Valgrind). The native getter test is red before the repair and green on both
C and LLVM, with both providers. The Object-only implementation is removed;
interface readers re-export the exact-key lookup backed by the same guarded
intersection walk as native marker names. A focused unit covers Name,
Private and Symbol keys through nested and cyclic intersections, retaining
the getter's nullable type. This also covers the audit's defensive projections
at the common lookup boundary.

Ordinary intersection-typed parameters are refused by main, so an attempted
intersection execution fixture is not counted as agreement. The native
getter control supplies the executable intersection coverage.
Symbol destructuring and a symbol method on a derived typed array were refused
on main during reduction, so no execution agreement is claimed for them.

## Dependency admission and recorded complaints

A previous dependency lock supplies recovered source locations, never admitted
packages. A private config extends the current requested config with those
locations, retaining its roots. Each resolution pass replaces the admitted
packages with the current root-reachable native resolutions. The settled
multi-layer control resolves once, and removing its last root import removes
the entire installed chain. Package versions come directly from the native
`ResolvedImport` record; no PackageID display-string parser survives.

Standalone `nts deps` resolves on every run. It can reuse the previous complete
check's complaints after the adapter replays every recorded host observation
through `Session::inputs_match`. The memo's request identity includes the
requested config, the report producer's source/build stamp and the adapter's
compiler/settings/environment identity. The original physical spec and its
host inputs are retained; this path has no rewritten overlays or extra roots.
Config and inherited config contents, ambient declarations, source files,
libraries and negative resolution lookups are validated by the same native
host that read them. Persistence only converts typed input records to a DTO;
it implements no filesystem fingerprinting.

A memo hit starts no program or diagnostic pool for the check. Misses run the
ordinary explicit non-default-library `Files` scope and replace the complete
diagnostic vector, including clearing complaints that disappeared. Ordinary
builds continue to attribute their compilation snapshot's diagnostics rather
than run another check. The acquisition tests keep TS2591 assertions
non-vacuous on cold and settled runs; the memo controls cover settled reuse,
an ambient edit, an inherited option change, a recovered-source edit, a new
higher-precedence resolution winner, and a changed compiler identity.

The review series uses schema version 47 for the atomic native switch (typed
keys and lossless text together), then 48 for the separate ProjectSemantics
projection and governed-construct refusals. Main before the series is 46.

### Acquisition survey preflight

The reconstructed survey's recovery-only Go and native reports both contain
143 packages, 16 acquired and 110 published-JavaScript-only packages. The
native settled and repeated memo-hit reports are byte-identical; the memo's
mtime is unchanged, while a miss always rewrites it. All package names and
recovery routes agree between the corrected Go and native reports.

| Difference | Classification and control |
| --- | --- |
| drizzle-orm version 3.4.9 becomes 0.45.2 | The old display-string parser read the postgres peer's version; native `ResolvedImport.package_version` supplies the package's own version. |
| zustand version 11.1.18 becomes 5.0.15 | The same old parser read the immer peer's version. No Go parser repair is carried in this series. |
| Zod gains one TS5115 complaint about `IsOptionalIn`, `$ZodTypeInternals`, `$InferZodRecordInput` | TypeScript 7.1 change, reproduced by the unpatched 3e9236361 CLI on the identical generated project. |
| Minipass TS2740 ends with "11 more" instead of "8 more" | TypeScript 7.1 library/diagnostic change; the unpatched 3e9236361 CLI prints the same native message. The count remains one. |
| Equal-frequency complaints change order in class-transformer and tar | Presentation order only; code/count maps agree. Each native repeated report is byte-stable. |

The control's complete diagnostic log is
`scratch/tsrs-lane/survey-3e9236361-diagnostics.log`; the old and native reports
are retained as `survey-source-map-settled.json` and `survey-native-hit.json`.

The settled acquisition timing uses ten interleaved repeats on CPU 4 under
`with-lock`, sibling 5 idle, `nts-dev` for all arms, and one checker. Each
arm's settled `.nts` and generated config are restored outside the timer.
Every complete report hash matches its preflight; every native sample leaves
the memo mtime unchanged, proving it did not run the miss path's check.

| Arm | Packages/acquired/JS-only | Median ms | Range ms |
| --- | --- | ---: | ---: |
| Original Go admission | 141/14/110 | 1,026.052 | 989.676–1,062.296 |
| Recovery-only Go repair | 143/16/110 | 1,023.483 | 976.092–1,069.717 |
| Native current-root admission, validated complaint memo | 143/16/110 | 538.616 | 528.103–575.075 |

The user-facing settled `nts deps` operation takes 47.4% less wall time
(1.90x faster) than the same-window Go arms. Native deliberately reuses
validated complaints without checking; the Go operations re-check. This is an
operation-level comparison, not checker throughput. The earlier 817 ms baseline and earlier recovery-only
816 ms comparison belong to their own matched windows, not this ratio.
Commands are `nts deps <same-absolute-config> --json` on Go, and the same plus
`--checkers 1` on native; both environments set `GOMAXPROCS=1` and
`NTS_CHECKERS=1`. Exact argv, binary/source hashes, stable report hashes,
restored-state paths and samples are in
`scratch/tsrs-lane/deps-native-timing/timing.json`. Native execution pin is
5d8338933b7af61bbd78b7a6c62e801f496defb9; the old arms are the saved
784e697dcc37 baseline and the production-identical 8f74a89c4 recovery repair.

## Stable upstream corpus comparison

Both arms use the same reporting-only `--rows` module and the same ordinary
program configuration and backend verification. Main's unmodified f42c98bbb
suite and its scratch rows-enabled build both measure 61 lowered, 36 refused,
87 rejected, and zero frontend, invalid-HIR, C or JVM output failures. The
checked-in 60/37/87 aggregate was stale. The pre-cast 17791f3c3 rows are also
identical to f42, ruling out the later cast fix as the source of that drift.

All 316 old source paths exist at the new pin; both selections examine the
same 184 single-file cases. Native records 61 lowered, 37 refused and 86
rejected, with zero crashes or invalid output. Exactly five rows differ:

| Case | Difference and classification |
| --- | --- |
| declarationEmitConstObjectLiteralGenericMethod1 | Still refused; the removed raw Structured flag description is replaced by the semantic name Array. |
| excessivelyDeepConditionalTypes | Rejected becomes lowered. The only source edit is an issue-link comment; unpatched TypeScript 3e9236361 accepts the identical strict ESNext/bundler/noEmit input with exit 0 and empty diagnostics. TypeScript 7.1 change. |
| exportDestructuringIterator | Upstream adds three destructuring statements; the additional foreign-return ABI refusals describe those new constructs. |
| nestedGenericTypeInference | Upstream adds a Column/table inference example; its declared foreign table function adds the same ABI refusal family. |
| regexInvalidUtf8WithUnicodeFlag | Lowered becomes refused for its regular-expression literal. Both source files contain raw invalid UTF-8 byte 0x80; the old runner substituted an empty program on decoding failure. The new runner copies the bytes unchanged. No agreement is claimed for the old empty input. |

Raw rows, the reporting-hunk proof, and the real-checker control are retained
under `scratch/tsrs-lane/corpus-comparison/`. The new full selection contains
10,918 single-file cases: these 184 plus 10,734 newly selected paths. The latter
are a first census, not a comparison against an unmeasured old population.
Crashes and invalid outputs there are recorded by path and site as backlog;
the stable manifest remains the landing gate population.

## Repaired-source paired validation

The production compiler at `8dbcd0cc0d923fa6ab85c66f41511e2e40299b90`
was built with plain `cargo build --release`, with a clean tree verified before
and after the build. Its sealed `nts` SHA256 is
`80b8d65df8c9124ef8d5432ffa0224fc4259547d2ec3a7f0fa5bf8cf35a1580e`.
The before arm is unmodified main
`ecdc70411ff2325b77bb2098feb6158a3462f7ea`, SHA256
`9c25eda60796cbe0865e39bbe89d920c3a67ee1f7c5411a46d277e1d5e30b901`.
Each arm runs the same current 746-program inventory, with two workers,
`NTS_CHECKERS=1`, the backend selected by `NTS_BACKEND`, and RC off.

| Backend | Unchanged | Fixed | Regressed / changed / unstable / unmeasured | Full / partial / nothing | Compared / planned cases |
| --- | ---: | ---: | --- | --- | --- |
| C | 744 | 2 | 0 / 0 / 0 / 0 | 724 / 10 / 12 | 134,701 / 135,358 |
| LLVM | 744 | 2 | 0 / 0 / 0 / 0 | 724 / 10 / 12 | 134,701 / 135,358 |
| JVM | 744 | 2 | 0 / 0 / 0 / 0 | 724 / 10 / 12 | 134,701 / 135,358 |
| Wasm | 744 | 2 | 0 / 0 / 0 / 0 | 724 / 10 / 12 | 134,814 / 135,358 |

All four after arms have zero wrong answers. The two improvements are the
lone-surrogate program (wrong before, 232 comparisons and no refusal after)
and `exact-keys-through-member-reads` (261 comparisons across nine functions
before, 290 across ten after). The latter is additional public structural-cast
reach, not a second claim about the shared-private lookup fix.

The first C attempt on the earlier `5fa5e5e90` tree covered 747 programs and
reported one unmeasured input under both compilers:
`a-standard-decorator-keeps-the-class`. Node 24's strip-types loader rejects
`@decorate`. That option-policy input was moved unchanged into core's fixtures,
with its core test preserved. It is not counted as execution agreement. The
746-program runs above repeat both arms on the same corrected inventory.

The whole-program capture audit was invoked explicitly on the 8db source and
found no unrequested reachable type. The separate explicit diagnostic-scope
audit compared complete ordinary and composed diagnostic vectors across all
824 selected program and interop configs; every pair matched. Neither result
is inferred from an ignored test in the default workspace run. The default
workspace run on the production-equivalent `5fa5e5e90` source passed 2,347 tests,
with zero failures and eight explicitly ignored tests. The moved core test,
format check and strict workspace Clippy were then rerun on 8db.

Exact commands, arm provenance, verdicts and logs are retained in
`scratch/tsrs-lane/independent-paired-8db/`, with the sealed compiler beside
`validation-release-8dbcd0cc0d92/provenance.json`. These are correctness runs;
their elapsed times are not benchmark results.

### The public structural-cast improvement

`KeyedOwner` initializes a symbol-keyed field, then writes public `value` in its
constructor. The old text-only own-field query fails to recognize
`this[key] = n` as a write into the receiver's own storage. The publication
proof therefore treats `this` as exposed and stops before it can prove the
later `value` write. That withholds the structural-cast field license from
`castNamed`, and its exported caller `erasedName` is refused.

The typed key query recognizes the exact unique-symbol field and keeps the
receiver local. The later public write is then proven, and the existing field
license permits the cast read. A one-change control reverses only the two
constructor writes; all runtime field values remain the same:

| Constructor order | Go main | Native |
| --- | --- | --- |
| Symbol write, then public value write | 261 cases / nine functions; public cast refused | 290 cases / ten functions; no refusal |
| Public value write, then symbol write | 290 cases / ten functions; no refusal | 290 cases / ten functions; no refusal |

The existing core initialization fixture now includes `SymbolWriteFirst` and
`SymbolWriteLast`, and the `Ready` unit requires both to prove `value` ready.
That unit and strict workspace Clippy pass at test-only checkpoint `b310c83a6`.
Raw control sources, config, argv and outputs are retained under
`scratch/tsrs-lane/exact-key-publication-control/`.

### Why Wasm compares 113 more cases

The population and planned case count are identical. Existing backend decline
patterns cause different amounts of progress through the differential's cases;
they are unchanged between before and after within each backend. These rows
account for the complete observed net difference:

| Program | Wasm compared minus C compared |
| --- | ---: |
| `a-length-read-through-a-field` | +37 |
| `arrays` | +106 |
| `number-tostring-radix` | +81 |
| `strings` | +5 |
| `super-on-a-typed-array` | +12 |
| `async` | -116 |
| `promise-constructor` | -12 |
| Net | +113 |

`array-from` and `growable` also have different decline counts, with no change
to their compared counts. The per-program numbers are retained in
`independent-paired-8db/backend-coverage-delta.json`. Refused, declined and
unreached cases are not counted as successful comparisons.

### Audit and release hold

The raw SDK semantic-code audit attempted all 47,504 selected Test262 files.
It measured 47,502 and recorded `complete: false`: exactly two pristine native
checker panics remain, both the yield-thenable cases documented in
`tsrs-yield-thenable-diagnostic-panic.md`. The 304 phase-import capture failures
were fixed by query-role selection; four unrepresentable semantic-name captures
remain named refusals, while their raw diagnostic checks complete.

No checker pin, allowlist or record is relaxed using this incomplete audit.
The 20 checker-bound Test262 records, four TypeScript runtime records, final
candidate wide run and matched production-output/whole-pipeline timing remain
required. No switch landing or performance claim follows from the paired
correctness results above.

## Post-sweep tooling and Java interface checks

Checkpoint `333368687` removed the scheduler/slice/timing entry for the deleted
producer-cache step and every active producer-cache environment assignment.
The immutable corpus case-root store remains. All 51 scheduler and shell step
names match. Its interop run finished 72 projects: 46 succeeded, 25 reported
named Apple/Windows execution skips, and one failed on the Java storage-name
capture. This attempt remains recorded as red.

That javap difference is exactly three package-private storage names:
`Cell0.value` becomes `n$value`, `Closure0.total` becomes `n$total`, and
`Session.$hits` becomes `p$$hits`. The public/protected surface is identical.
The untouched Java consumer compiles with `--release 8` and runs under
`-Xverify:all`; the narrow expected-name update preserves the visibility
assertions and changes no production naming rule.

Checkpoint `1c3367568` passes the corrected Java build script, all 180 tooling
tests, workspace strict Clippy and formatting. The three imported-name tests
also run and pass after their helper stops silently returning on native
capture or preparation failure. A separately retained earlier tooling attempt
killed both workers in the aggregate-memory control; its two `memory-cap`
rows correctly reflect two kills. Quiet isolation records aggregate `oom=1`,
worker `oom_kill` deltas 0/1, one victim plus successful survivor and subsequent cases.
No cap or runner code was changed, and the earlier failure is not erased.

These are independent checks, not a claim of a green candidate full run.
The two pristine checker panics still leave the raw audit incomplete and
checker-bound records unrepinned. Final existing-WIDE validation, source
reconciliation and the matched performance decision remain owed.


## First candidate full run: red, with runtime regressions

The existing WIDE steps ran on frozen source
`78ecf43438e69068a59424947fd53f221809226a`, in candidate namespace
`CANDIDATE-78ecf43438e6-1792879492853`. The summary is **11 PASS, four FAIL,
one accepted on-device skip (no device), zero not run**. It is retained as
red. No records, thresholds or main full-run markers were changed.

The actual candidate compiler hash is
`a0540a974da2622f4da64a80ac00fb95d77ba170a1c47863943f13965c949c67`.
The separate primary-tree build at the same source has hash
`80b8d65df8c9124ef8d5432ffa0224fc4259547d2ec3a7f0fa5bf8cf35a1580e`;
they have distinct build paths and provenance and are not relabeled.

Both integrity steps failed because the producer-cache cleanup also deleted
`timedRun`, which the prepared-listing collector still reads. The pending
repair restores only the prepared-listing measurement selector. Its real
child/collector control fails on the original source and passes with the
repair, covering KEEP absent/present and all four listing commands. It uses
a deterministic perf shim and makes no PMU measurement claim. Exact unit-owned
child accounting found no orphaned listing children before the control.

Definitions independently measured all 29 modules; missing shared integrity
metadata caused fallback work, not its verdict. Four rows fell below their
existing floors: assert -10, console -30, events -18 and util -7. Same-root
function, origin and signature attribution is in progress; the floors remain
unchanged.

Profile passed its existing contract while recording six nonzero emit statuses.
The addon step independently reported invalid HIR for all six. A serial replay
on the same physical source/config root compared the exact native artifact
against immutable Go baseline `ecdc70411ff2325b77bb2098feb6158a3462f7ea`:
crypto, fs, http, process, stream and zlib all fail natively with
`SyncShareController#cancel -> Iterator<T>#return`, expected one argument,
found two. All six Go arms exit zero and write C, header and addon artifacts.
Full stdout/stderr, exact argv, population hashes and every emitted artifact
hash are retained under `scratch/tsrs-lane/six-emission-triage-78ec/`.

The reduced source calls a no-argument implementation through
`Iterator<number>`. The native arm reproduces invalid HIR and Go emits it;
changing only the field's declared receiver type to the concrete class makes
both emit. The snapshot correctly preserves the library's optional value
parameter. The dispatch contract projection skips its `Function | undefined`
property type, leaving a shorter concrete declaration while the call supplies
the interface's argument. A gated fixture and core guard pin the regression;
a production repair is under review. The proposed shared projection keeps
presence checking separate and must leave ambiguous/noncallable unions
unproved. No metadata suppression or vendor workaround is proposed.

All 28 original profile statuses and artifacts are preserved. A separately
reviewed pending tooling hunk retains each future module's complete emission
output alongside its status; it changes no profile policy. A corrected full
run remains owed after the actual runtime regressions and definition changes
are resolved. The raw two-case checker-audit hold is unchanged.

## Subsequent checker and runtime repairs (not a full-run verdict)

The earlier two-case audit hold above is historical. The latest upstream is
`a0db53eabe483062205717f067a49b6ccb3fc868`, with TypeScript still
`3e9236361fa97a9e6c685f4833ac457ae2d8c50a`. The explicitly carried
`31522736` patch preserves the yield error diagnostic and continued traversal;
its provenance, focused controls and removal condition are recorded in
[the yield investigation](tsrs-yield-thenable-diagnostic-panic.md).
On source `bfe47788d8a96cd88086dac6528034fcdbcb047a`, the independent raw
SDK audit completes all 47,504 files with zero unmeasured cases. All 47,502
previously measured per-file code sets are unchanged. No semantic-code
allowlist change follows from this result.

The same source passes the workspace test run: 2,353 passed, zero failed,
eight ignored across 310 binary/documentation groups. The ignored audits are
separate obligations: the explicit capture audit covers 749 program configs;
the scoped-diagnostic composition audit compares all 825 configs (749 program
and 76 interop), with zero load errors or vector differences. The first scoped
audit invocation lacked its required config-list environment and remains a
recorded launcher failure; the corrected run is separate evidence.

The optional-callable projection now preserves the library's truthful optional
metadata and one canonical interface ABI. The original five-export fixture
compares all 145 cases on each of four backends, on both Go and native arms,
with empty stderr. On the same frozen source/config/root population as the red
candidate, all six native runtime emissions now exit zero and produce their
24 expected artifacts. Their complete output contains no invalid HIR or
NTS0003. Other named refusals are retained. This clears that arity regression;
it does not relabel the original candidate full run as green.

The plain release artifact for these checks is source `bfe47788d`, SHA-256
`ac7976b848d9aef90f4b32e73a54c9e985c7158dc9a90be51f772d51916752e3`.
Exact commands, summaries, source checks and artifact hashes are under
`scratch/tsrs-lane/post-audit-correctness-bfe/` and
`scratch/tsrs-lane/post-audit-correctness-bfe2/`.

### Carried return contracts and definition attribution

The subsequent source `9fb5db1ca39b12d5888199b0620c06998e059866` repairs a
second real loss. The early generic-form gate hid the already-supported
`AsyncIterableIterator<T>` contract before the finite carried-member policy
could apply. A copied class method needs that declared return shape even when
T belongs to its class. The repair uses the existing carry predicate at both
boundaries, adds no type families and preserves the allowance, three form
levels and shallow unused returns of generic signatures.

The same-root arena comparison identifies ReadableStream's declaration span
12643–32388, its own T at 12671–12672 and values at 30409–30753 in
`runtime/web-platform/src/streams/readable.ts`. Go records an Object return
with the iteration members; the previous native source records Structured.
These identities are source declarations and arguments, not matching numeric
arena IDs. The repaired prepared listing restores the four values bodies,
four symbol-keyed async-iterator bodies and four iterator constructors. Their
previous AsyncIterableIterator-return refusals disappear. Raw multiplicities
and the unrelated Fifo/Queue specialization differences remain separate.

The gated mechanism fixture is
`tests/programs/a-generic-owner-returns-a-carried-iteration-contract/`, with
`compiler/core/tests/carried_iteration_return.rs` checking capture, the actual
lowered call/declaration object ABI and verified final preparation. Its
per-instance counter proves the selected method executed. Both scalar exports
compare all 58 cases on C, LLVM, JVM and Wasm, with empty stderr. The small
subject was also refused by old Go: it guards the mechanism; the runtime
module's lost bodies establish the switch regression. Early guard failures
incorrectly required an inlined private method to survive, then equated its
declared and instantiated TypeIds; those attempts remain recorded separately.
The final guard checks the common protocol and actual Number argument instead.

All 29 frontend unit tests pass on this source, including the existing
recursive-generic and 30-large-module completeness guards. No graph is partial;
fs records 22,295 types against 15,414 reached, and the largest recorded/reached
ratio is 1.615 under the unchanged bound. React reconciler's 170 type diagnostics
remain a diagnostic workload, separate from capture completeness.

The new plain release SHA-256 is
`79cb1134440fa023af90ecff4ba23039a412d11c8eb71d7ee4c8adeab7be122e`,
with exact source/tree/build provenance under
`scratch/tsrs-lane/carried-contract-repair/fixed9fb5db1ca/`. Temporary owned-arena
instruments are separate, unshipped and untimed; their prepared listing bytes
are checked against the original compiler before their dumps are used.

The four-module definition/refusal mapping was subsequently completed on that
same `9fb` source. The unchanged definition floors pass with totals
2,116/2,198/2,077/2,145 for assert/console/events/util. These include
147/177/136/152 abstract declarations; concrete bodies are
1,969/2,021/1,941/1,993. A gate definition total is not a count of emitted bodies.

The remaining Fifo/Queue count difference is disconnected old output. Fifo's
236 fewer bodies comprise 45 partial families of four bodies (31 captured
free-parameter forms and 14 old-materializer opaque-union copies), five
ReadRequest families of eight bodies at distinct free-parameter declarations,
and two eight-body families called only by two disconnected Queue copies.
Those Queue copies account for another 16 bodies. The two Queue argument
unions retain their exact Undefined/closeSentinel/Unknown or Any provenance;
no general equality between unions is inferred. None of these removed
families has an external incoming root, allocation, layout method/implements
slot or entry API. The old allocated request-union Fifo families are explicitly
excluded from that set. Exact declaration spans identify the two retained
partial families and the five extra free-parameter declarations.

The full raw per-family headers, signatures, body hashes, argument provenance,
incoming symbol/function-reference edges, allocations, layouts and entry API
are retained in `definition-arena-analysis-9fb/fifo-queue-attribution.json` in
the scratch evidence. Raw lower/layout observations are distinguished from
final prepared listings. Another 21 concrete definitions are gained elsewhere
(FormData iterators/selectors/constructors, desiredSize and BYOBReader.cancel),
so the concrete net change is minus 231 per module; abstract declaration
changes separately reconcile each total. No disconnected specialization was
recreated merely to match the previous count, and no floor was edited.

An explicit audit of the newly added mechanism fixture then found a further
required edge: a non-generic Cursor<Source.T>.next return contains
Promise<anonymous payload>, reached at the final ordinary form level. Its
anonymous storage payload must be recorded because provided_representation
and slot_for consume it. The repair follows this existing ABI storage demand
through owned object fields, arrays, unions and non-generic callable contracts;
nominal forms retain their three levels and generic callable returns stay
shallow unless independently demanded.

Compiler review rejected the first storage proposal (`35a9`): deferred provided
generic arguments could discover fresh instantiations without charging the
native-service allowance. The corrected source charges before classification,
argument queries and expansion, including deferred forms. Reopened own forms
pay again; max(4096, seed count times 16) is unchanged. Already owned shapes
replay recorded edges separately without native queries. That edge walk adds
bounded work over recorded nodes/edges; it is not described as zero added work.

On source `6660a66154d9b7609a0d89356a3be9928b5c4b0e`, all 32 frontend units,
the exact captured/lowered/prepared ABI guard, the active completeness guard,
strict workspace/all-target Clippy, the full 750-program capture audit and
826-config scoped-diagnostic comparison pass. The finite 24-Map chain exhausts
at eight native services with NTS0003 and completes at 128; the same unused
generic return stays shallow. A late Promise demand replays the owned payload,
array and union with only Promise serviced. These controls run with one and
four checkers. The charge-only counterfactual `38890fe08` fails at the actual
uncharged-service assertion. Pre-storage `e965e7d44` and fixed capture share the
exact syntax/node-type witness explaining why the written recursive alias is
independently demanded; that whole-snapshot alias was never an isolated-unused
return control. Earlier failing assertions and source identities are retained.

The large-module checks remain complete: fs records 22,321 types against
15,414 reached (26 more recorded than `9fb`), and reconciler remains
5,206/4,761 with its separate 170-diagnostic workload. No allowance or ratio
bound was increased. Evidence is under `storage-demand-666-validation/` and
`storage-demand-counterfactual-controls/` in the scratch evidence directory.

Final checker-bound records,
paired sweeps, corrected existing candidate WIDE run, matched equivalent-output
performance measurements and final review remain owed. Earlier Go/native
frontend timing ratios were withdrawn because their capture work differed;
none is reinstated here.


### Declared reference arity and the final dispatch guard

The first combined review series ended at `10f851b2924be93fd91bb51ed5e61778c4461bdf`.
Its complete workspace attempt is retained as red: 2,355 passed, two failed,
eight ignored across 311 binary/documentation groups. The entire eight-test
multi_emit binary then passed on unchanged source with the launcher's
RUST_BACKTRACE/RUST_LIB_BACKTRACE variables unset. The other failure was a
real dispatch regression, not an environment mismatch. The unchanged
optional_interface_arguments binary passed on bfe, but failed on 9fb, 666 and
10f with the same fixture/config hashes and ordinary single materialization.

An owned-only temporary instrument, separately sealed and checked for exact
plain/helper stdout, stderr and status equality, isolated the semantic edge.
On bfe the receiver-bound Iterator heritage was Structured, while the ordinary
three-argument receiver carried members. On 9fb both carried members, and the
heritage appeared first with a fourth, synthetic receiver argument. Carried's
first-record argument-length guess then chose arity four, so the ordinary
three-argument receiver lost its implementing class body. Captured and
materialized arenas were byte-identical within each arm: an extra materialize
pass was not a repair.

The source repair records the native target's declared outer/local parameter
count from the existing public InterfaceType getter, after the ordinary
argument query. That count excludes the appended receiver binding; declared
arguments may themselves be polymorphic this. The snapshot stores the fact
only for the existing carried-dispatch consumer, includes its sorted-key form
in the canonical digest, preserves it through serde round trips, and copies
it to newly materialized instances. Ordinary postcard map bytes are not
claimed canonical. Missing differs from known zero. Missing vectors, truncated
prefixes, multiple trailing bindings and contradictory declaration facts prove
no carried resolution. Every canonical duplicate remains a dispatch root;
augmented views resolve through the exact declared prefix, independent of
record order or argument kinds. No traversal allowance or form level changes.

The reviewed WIP49 checkpoint is `404c280ff73b96794a8cfa1160a422f4aab98d2d`.
Its focused checks pass: SDK declared/augmented/explicit-this/known-zero facts
at one and four checkers, schema digest/serialization/validation, duplicate and
malformed carried roots, created-instance metadata, the unchanged original
optional-interface ABI guard and missing-member neighbor, carried-return ABI,
and all 32 frontend tests including boundedness. The original five exports
compare all 145 cases against Node on C, LLVM, JVM and Wasm with empty stderr.
The sealed nts-dev correctness artifact is SHA-256
`3c6bcaeef4e12de21268ac99554aea5108001082473f4fa460745c5455fbfd73`.
It is not a release or performance artifact. Raw commands, source/tree records,
complete outputs and hashes are under `declared-arity-404-validation/` and
`declared-arity-404-execution/` in scratch; the original red contrast and edge
proof remain under `optional-interface-final-contrast/`,
`optional-interface-owned-facts/` and `optional-interface-dispatch-facts/`.

The WIP49 fact belongs in atomic switch47, followed by ProjectSemantics48.
Final folded-source workspace/backend tests, explicit audits, paired sweeps,
20 test262 and four TypeScript records, corrected existing candidate WIDE,
equivalent-output performance evidence and final review remain separate
obligations. These focused results do not relabel earlier attempts or permit
record, allowance, floor or timing changes.

### Existing-record member identity repairs

The v8 combined source `2133fa9cabfb766d54a1ed721067be7eb1bc0d60`
completed the normal-environment workspace run: 2,362 passed, zero failed,
eight ignored, across 311 binary/documentation groups. Both ignored switch
audits were run separately: 750 program configs and 826 scoped configs
(750 programs plus 76 interop), all complete and identical. Atomic47 and
combined48 strict workspace/all-target Clippy passed. The plain release
artifact is `fb5efb56bd397872e2e92ef885cfa0f156ba430cab2ef275bb1f52ae4bb1b526`.
The renewed six runtime emissions, four unchanged definition floors and
original five-export/145-case program on all four backends passed. Four paired
sweeps measured 748 examples: 745 unchanged, three fixed, no regressions,
changed/unstable/unmeasured rows. Declined and unreached case populations
remain recorded separately; matching refusals are not executed agreement.

The first required C/language record then found eight regressions in its
unchanged 8,369-case population. Same-input replay against frozen Go `ecdc`
confirmed all eight were current-Go/native differences: six lost compiled
cases and two lost passes. This stopped record progression; no TSV was
accepted or refreshed. The defects were reduced to four mechanisms:

- Simple Unicode identifier parts bypassed the existing C escape path and
  hit the emitted-identifier assertion. The repair spells non-ASCII parts
  through that path while retaining the assertion, ASCII display-label
  rejection and emitted-name collision checks.
- A semantic numeric computed key used Rust number spelling while its call
  used JavaScript spelling. Both now use the existing JavaScript formatter;
  the precision-sensitive raw numeric-literal path is unchanged.
- Static getter, setter and compound paired-getter calls reconstructed raw
  names instead of using the shared typed `MemberKey` encoder.
- Four consumers inferred polymorphic `this` from matching display names.
  The public native `is_this_type` fact is now captured explicitly, stored in
  the snapshot and consumed through one shared semantic query. Ordinary
  constrained parameters, including matching class names or symbols, remain
  unproved by that query. Declared-reference arity is preserved separately.

The reviewed repair is WIP49 commit
`521a7dde78154c6bdefa4e215d6fcc0b62c9c681`, with test-only observation
correction `32040c09787667ed5923208a02906f5eea63c6be`. The first new preparation
guard counted exported `module#init` as a source function and failed; the
corrected guard uses the compiler's reserved initializer identity, verifies
its exported zero-parameter/Void contract and still requires both source
exports. That original failed attempt remains under `record-repair-focused/`.
The retry under `record-repair-focused2/` passed all 46 tests plus formatting,
including SDK one/four-checker facts, snapshot digest/cache, all four receiver
consumers, numeric spelling, complete fixture preparation, declared arity,
optional dispatch and existing capture-budget controls.

The six gated programs include unchanged original reductions and a separate
private/public static accessor pair whose observable state and trace pin
setter/getter/compound order. The sealed `nts-dev` correctness artifact is
`22dd9190b070bf1e793cd320acf249872c8be4abdeecb812625da9b14c3af9b1`, from exact
`32040c097`, schema49. Of the 24 program/backend cells, 23 execute all 58 cases
across both exports and agree with Node with empty stderr. The identifier/JVM
cell refuses duplicate method `$$(D)D`: frozen Go, pre-repair native and repaired
native produce byte-identical NTS4004 output; their ASCII controls all execute
58 cases/two exports. This pre-existing JVM collision is explicitly retained
as a refused cell, with zero executable/agreement cases, rather than reported
as a 24-cell green run. The full matrix and historical attribution are under
`record-repair-execution-rest/` and `record-repair-jvm-identifier2/`; the first
failed execution and a triage controller's pre-compiler syntax failure remain
separate evidence.

The original eight readonly case/config roots were replayed with the repaired
artifact. Both prior passes are restored; all six private-member cases regain
compiled execution and reproduce Go's exact existing Test262Error outcomes.
Those six remain wrong answers, not new passes. Every emission exits zero,
with source/manifest, raw stream, outcome and emitted-artifact hashes retained
under `record-c-language-eight-fixed/`. The earlier refusal/panic replay remains
under `record-c-language-eight-replay/`.

This evidence belongs to the stated sources. The receiver flag must fold into
atomic47 before ProjectSemantics48; final folded-source checks, all 20+4
records, corrected candidate WIDE, equivalent-output performance measurements
and final review remain owed. No record allowance, definition floor, corpus
selection or JVM naming change is part of these repairs.

### Historical v10 correctness and existing record renewal

The historical v10 compiled validation source is
`3e4e4f92f5d5c6c49bb41505093aafa9bc9b92d9`, tree
`4b1eb4d3bd91dfa03fbb74bbb2bdef17c4691ad1`. Atomic47 is `3bc92917339c` and
Project48 is `91f8259e0149`. Its compiled content differs from reviewed WIP320
only by schema normalization and an equivalent test-literal delimiter change.
The preceding v9 atomic Clippy run failed on needless raw-string hashes in
that test; the 366-byte TypeScript payload is unchanged. That red attempt is
retained under `shaped-v9-correctness/`.

On this exact final source, the normal-environment workspace completed
2,368 passed, zero failed and eight ignored across 312 binary/documentation
groups. Atomic47 and final48 strict workspace/all-target Clippy passed. Both
ignored switch audits were run explicitly: the full 756-program catalog and
all 832 scoped configs (756 programs plus all 76 interop configs) passed, with
unique complete owned vectors `Ok` and identical. Plain
`cargo build --release --jobs 4` passed. Its sealed `nts` is
`280a07f253aa53aac74925462782216712fd55b5d763f23937e3c698c13ee76e`, with
adjacent source/tree/build/upstream/carried-patch provenance under
`shaped-v10-correctness/artifact/`.

Fresh release checks reproduce the 23 full 58-case/two-export agreements and
one baseline-equivalent JVM identifier refusal; that cell contributes zero
executed cases. The original eight readonly cases again restore two passes
and six exact existing Go Test262Error failures. The original 145-case,
five-export optional-dispatch fixture agrees on all four backends. All six
same-root runtime emissions succeed with 144 hashed output files. The four
definition totals remain 2,116/2,198/2,077/2,145, including respectively
147/177/136/152 abstract declarations; the concrete totals are
1,969/2,021/1,941/1,993. Their floors are unchanged. The original 607 frozen
input files and all raw streams/artifacts were rehashed. These results are
under `shaped-v10-member-renewal/`, `shaped-v10-eight-replay/` and
`shaped-v10-runtime-check/`.

All 20 Test262 and four TypeScript records were checked against exactly their
existing populations: 26,005 backend-case entries, with identical committed,
measured and scratch path sets. The comparison reports 70 fixes and four
accepted-negative detail changes, with zero regressions, changed failures,
new failures, missing cases or new paths. The approved refresh preserves the
measured `3e4e4f92`/`280a` headers. No syntax evidence rule, definition floor,
scope or selector changes accompany those TSVs. The three typed checker-pin
entries and six Unicode path/code additions were already in the reviewed
source and retain their separate raw-audit/pristine-oracle evidence.

The four final paired sweeps each measure 754 examples: 751 unchanged, three
fixed, zero regressed, changed, unstable or unmeasured, with RC off. The three
fixed examples are carried iteration return, lone UTF16 code unit and exact
member keys. C and LLVM compare 135,252/135,909 cases; JVM compares
135,194/135,851; Wasm compares 135,365/135,909. C/LLVM/JVM have 110 declined
and 547 unreached cases; Wasm has 232 declined and 312 unreached. There are no
timeouts. C/LLVM/Wasm have 732 full agreements, ten partial and twelve with no
comparison. JVM has 731 full, ten partial, twelve with no comparison, and the
one known backend refusal, printed as `wrong, both` by the runner. Its
inaccurate linked-frontend banner is qualified explicitly: the before arm is
frozen Go `ecdc`/`9c25` with checker `4878`, while the after arm is linked
native `3e4e4f92`/`280a`. Full argv, environment, outputs, classifications and
record diffs remain under `shaped-v10-pairs-records/`.

Subsequent record/documentation shaping must preserve this compiled-source
identity rather than relabel its artifacts. The corrected existing candidate
WIDE, equivalent-output performance evidence and final review/landing gate
remain separate obligations; none is implied by these completed checks.


### Reviewed repairs after the candidate WIDE red

The candidate WIDE on `edeb8b1ea3cb`, tree `28c40d115464`, used the separately
sealed release artifact `5da91643`. Its existing 16-step runner completed
with twelve passes, three failures and one accepted on-device skip. The red
steps were general integrity, runtime integrity and DEX. This is a completed
red run, not a green candidate or a permission to land. Its full summary,
streams, input manifest and actual artifact provenance remain under
`candidate-wide-v11-final-evidence.json` and the original candidate run.
The original `78ec` red remains separately historical as well.

The following reviewed repairs were integrated after that run. They do not
change a record allowance, definition floor, corpus selection or known list.
Their evidence belongs to the stated source and artifact, rather than to an
untested reshaped commit.

- The JVM repair preserves distinct identifier parts in emitted names and
  separates original source labels from reflection invocation names in the
  versioned differential protocol. The four reviewed compiler commits were
  integrated with exact seven-file/JAR equality to compiler tip `19a6a02b3`.
  Its focused original identifier/control, encoding, protocol, old-JAR
  negative and D8 evidence remains at that compiler pin. The subsequent
  combined strict checks and reduced four-backend execution also include
  those integrated sources. Full combined DEX and WIDE remain owed.
- The Lazy repair materializes a shallow owned formal only through a complete
  same-symbol Object declaration, exact arity and closed substitution. The
  shared fallible record allocator enforces the existing cap when nested
  children consume its final slot. Signature allocation remains a separate
  accounting domain. On `c05fe5564`, fifty focused tests and the unchanged
  official Lazy outcome pass, preserving all three original observations and
  the control; raw/prepared evidence restores `resolve` and its three render
  calls. Two separately committed cap-only controls fail their real
  `Some(parent)` versus `None` assertions. The sabotaged nominal test reaches
  Object first and never reaches its Structured iteration; fixed green
  covers both. Safe source was restored before later work.
- The narrow layout-reader repair recognizes the actual typed symbol/space
  field rows and retains `methods : Type` as a field. It preserves the
  integrity judgment and both saved cast findings. The older ambiguity of a
  raw field label `methods two words` remains; this is not a complete parser
  for arbitrary unquoted labels.
- Final owned field-read facts use existing interface-access authority and
  exact active operations, typed keys, representation and receiver/use
  associations. Explicit eager mode, complete owner/row coverage, final
  default and row-body validation, dependency hashes and exact Unerase roots
  prevent the earlier held proposals from granting unsafe permission.
  Five real producer tests and the unchanged official self-test pass.
  On source `a54f669ec`, artifact `e7136af4`, the bounded CLI check preserves
  stripped prepared HIR and layouts byte for byte on the original and
  two-supplier fixtures, removes only their two reviewed cast findings and
  keeps all eighteen actual-fact negative controls red. Go's positional
  counterexample stays red. Metadata adds real listing work; no cost claim
  is inferred.
- Selected object-result contracts are retained per existing implementation
  copy in the reviewed narrow domain. Implementation parameter/default
  authority and fallback copies remain unchanged. Five pure tests first
  assert an eligible managed-object baseline. One unchanged normal-capture
  coherence guard then proves the qualified call and actual body have the
  same local object-result and scalar-parameter ABI. A separate scoped-observer
  unwinding/restoration control brings that module to two tests, not two
  captures. The original `29e31` semantic
  red and intermediate style/setup failures remain distinct evidence. A
  name-only unknown-result clone remains a negative control.

The latest combined focused source is
`a54f669ec39444d30c2c58e5f5267b23969b1cad`, tree
`519a7b2eaf52285320907edff9156476b91ca535`. Its sealed `nts-dev` correctness
CLI is `e7136af42216472dec36e72a1e19a8f065b227bf3efb564da293efb642f308ff`,
with manifest `d7b160ec69d88511f0b91b54f47acfd0f3be1f45750c68641e6229740366a59f`.
It is not a release or timing artifact. Evidence seals are
`ad960221` (Lazy fixed), `fa45edff` (cap controls), `82185c57` (field producer
and strict checks), `9b55c131` (eligible result tests and captured witnesses),
`71dfa4f9` (actual field CLI), and `0a5bd8ea` (factory-only execution).
The result-only fixture executes all 58 cases across its two exports on
C/LLVM/JVM/Wasm, agrees with Node and has empty stderr on every backend.
It discards the iterator: it proves no next/payload, receiver or Promise
fulfillment behavior. The original next-using variant and scalar neighbour
remain qualified earlier-gate/non-reproduction observations.

### Current runtime integrity disposition and remaining gates

The exact source above reused the sealed CLI for eight serial selectors on
unchanged fs/readline configs: prepared HIR, raw HIR, layouts and refusals
for each. The same 607 frozen inputs match manifest `37e87726`. All eight
selectors exit zero. The exact current integrity consumer measures both
projects: 3,688/2,526 declare-inclusive definitions, with respectively
3,333/2,350 concrete names and 355/176 abstract declarations. It reports zero
fresh or expired findings, retaining eight/four existing known findings.

This closes the observed rootlessness only within those two listings. The
raw source-anchored async-iterator caller now calls `on<str>@overload0`; that
exact target has an own refusal for `AbortSignalLike.addEventListener`'s
unrepresentable function type. Preparation removes the caller, and its
cascade points to that recorded root. No selected implementation body or
executable caller/result ABI was recovered on these real modules. The
stricter retained-edge consumer therefore exits one and its original
`complete:false` summary remains intact. Evidence seal `50f540ad` preserves
all nine rows, eighteen raw streams, full populations/refusal roots and final
empty-cgroup accounting. The old Go caller refuses a computed property
before this seam and supplies no equivalent executable-caller coverage.
There is no listener/iterator feature expansion or integrity waiver here.

At the v12 source-reconciliation point, the combined workspace/backend,
strict, capture/composition, release and renewal checks were still unrun.
The subsequent measurements below retain their exact source and artifact.
They do not convert the earlier runtime consumer1 into executable coverage.
The historical 756/832 populations do not apply to the final 759/835 catalog.


### Accepted final-v12 checks at their measured source

The tested combined source is
`07b52742d0686dea30f111f5ac465af1defd8651`, tree
`af237bbcc1c33eb306ccd981b5abda08a6e8fc40`. Its compiled/runtime/tooling/vendor,
tests, Cargo and tracked JAR bytes equal the reviewed focused `a54f669ec`
source. The exact v12 series preserves schema 46 → atomic 47 → ProjectSemantics 48 →
docs 48. The existing historical ProjectSemantics delta and its one native
capture-test argument adaptation remain unchanged.

The first full-workspace attempt genuinely exited101: 2,392 passed, one
failed and eight were ignored across 314 groups. The sole JVM sabotage test
needed a compiler-under-test binary before the planned release build.
Evidence `75323a5f` retains that setup failure; it was not a product verdict
or a green run. No test or harness changed. A separately reviewed fresh
continuation built the plain workspace release first, sealed its four
actual binaries, then supplied the fresh compiler explicitly as `NTS_BIN`
to the entire workspace. It passed 2,393 tests with zero failures and eight
ignored across 314 groups, including the original JVM sabotage test.

That continuation also passed strict workspace/all-target Clippy, the full
native capture audit for all 759 programs and all 835 unique program/interop scope
rows as `Ok` and `identical`. The 835 configs are 759 programs plus all 76
interop configs, including the nested ones. Its five fresh zero-status rows
and the three earlier successful atomic 47/final 48 formatting/strict rows
retain their original pins and streams under seal `978ffb58`. They are not
the failed first attempt relabeled. The official commands and normal unset
backtrace environment were preserved.

The mode-0555 release compiler is
`6768eb8d0734aa6382bd420b9e0924cf615c32bef62002caf2ea13839b9b7982`.
It and the actual suite, protocol and bench binaries have the mode-0444
provenance manifest
`db6228d9beff41afac57e2cdfe8cbdb89db6228521eee549f3f15bdfccfa8343`.
The build was plain `cargo build --release --jobs4`, from clean measured
`07b52742`; this is correctness evidence, not a timing or candidate-WIDE
artifact. Upstream `a0db` and explicit carried patch `31522736` remain
identified separately.

### Accepted records and paired sweeps on final-v12

On that exact release, all 20 Test262 and four TypeScript record checks pass
against their unchanged 26,005 backend-case populations. Committed-before,
scratch and judged path sets match, and every data row is byte-identical:
24,070 passes and 1,935 existing failures. Every comparison category is zero.
Seal `76097cc1` preserves all 28 actual zero-status steps: the 24 records,
C/language first, followed by four complete paired sweeps. The approved
header-only checkpoint `4952c6bc` changes exactly one compiler provenance
header in each of the 24 TSVs. Its actual `07b52742`/`6768` source, harness, backend
and machine values are retained; no record data, rule, floor or selector
changes accompany it.

All four paired sweeps use the existing 757 examples, with no regressions,
changed results, instability or unmeasured examples. C/LLVM/Wasm report 752
unchanged and five fixed; JVM reports 751 unchanged and six fixed, including
the repaired identifier spelling case. The common five fixed examples are
the result-only generic overload, carried iteration return, lone UTF16 code
unit, two-supplier symbol layout and exact member keys. C/LLVM/JVM compare
135,484/136,141 cases, with 110 declined and 547 unreached. Wasm compares
135,597/136,141, with 232 declined and 312 unreached. All have zero timeouts.
Each native backend reports 735 full agreements, ten partial agreements and
twelve examples with no comparison. Neither partial nor unreached cases are
promoted to full agreements by the lossy output-only verdict labels.

The before arm remains frozen Go `ecdc7041`/`9c25eda6` with checker `4878b658`;
the after arm is native `07b52742`/`6768eb8d`. The inaccurate raw linked-native
banner is qualified by those actual artifacts and explicit Go environment.
The prior JVM decline and all earlier failed attempts retain their original
pins; they are not a new exception in this run.

### Accepted final-release renewals and remaining boundaries

Seal `25ee6f23` records the separately reviewed run of 63 renewal steps on the same
`07b52742`/`6768` artifact, without a build or new Go invocation. All 63 steps
exit zero with no signal. Its 36 direct backend checks comprise the original
six member programs on all four backends at 58 cases/two exports, the
result-only factory on four at 58/two, the two-supplier layout fixture on
four at 116/four, and the original optional-dispatch fixture on four at
145/five. Every cell agrees completely and has empty stderr. All 24 member
cells execute, including the repaired JVM identifier cell: there is no
baseline-decline allowance.

The four field prepared/layout selectors and unchanged exact consumer
preserve stripped HIR and layout bytes, retain the full function/layout
populations and all eighteen actual-fact negative controls, and leave Go's
positional counterexample red. The unchanged official Lazy outcome holds
all three observations and the control without a record write; its three
same-input selectors retain the formal/resolve/render roles and three
render calls with nothing refused. The original eight readonly Test262
roots preserve their exact source, manifest, key and config identities.
Native replay restores two strict passes and matches the six retained Go
Test262Error failures exactly. Those six remain failures.

The six same-root runtime emissions each retain the full output population of 24
files, 144 hashes in total, with all raw unsupported refusals kept.
They show no NTS0003, invalid-HIR or panic finding. Successful emission does
not establish all-function execution. The four declare-inclusive definition
counts and unchanged floors are:

| Module | Total | Abstract | Concrete | Floor | Headroom |
| --- | ---: | ---: | ---: | ---: | ---: |
| assert | 2,151 | 150 | 2,001 | 2,092 | 59 |
| console | 2,232 | 179 | 2,053 | 2,194 | 38 |
| events | 2,111 | 138 | 1,973 | 2,063 | 48 |
| util | 2,179 | 154 | 2,025 | 2,118 | 61 |

All four definition stderr streams are empty. The same 607 frozen inputs
match manifest `37e87726`. All 620 sealed renewal files and raw hashes are
retained, and the unit ended successfully with no main PID, control group
or active resident census worker. No source, fixture, policy or record data
changed during these checks.

The runtime disposition `50f540ad` remains historical at `a54f`/`e713`:
actual consumer exit 1, explicit `AbortSignalLike.addEventListener` own refusal,
prepared caller/body absent and executable caller/result ABI unsupported
and unrestored. Compiled-source equality carries that truthful limit; it
does not renew those eight selectors on `6768` or turn them into a green
retained-edge result. The factory check still discards its iterator and
proves no payload, receiver or Promise behavior.

The final candidate folds only the approved 24 measured compiler headers
and this truthful record update into the schema 47 → ProjectSemantics 48 → docs series.
All compiled/runtime/tooling/vendor/tests/Cargo/JAR bytes remain equal to
tested `07b52742`, and every measured artifact keeps its actual source pin.
No repeated standalone workspace/release cycle is claimed or needed for
this metadata movement. The official candidate WIDE and scoped task/operation
measurements subsequently completed on `3a04214b`, as recorded below. Final
review and the actual landing gate were unrun at that metadata checkpoint.
The later V14 landing gate is RED/NOTLANDED, as recorded below. Original `78ec`
and `edeb` WIDE reds and all recorded wrong, partial, declined and unreached
populations remain part of the evidence.


### Candidate WIDE and scoped operation measurements

The measured candidate is `3a04214b585f557894cc7ba407e83b84169314af`,
tree `44b2d969da83e2b9ae774f19abb48c53a5ad1bdc`. The official candidate
build produced sealed release compiler
`661cd8b0eca27d52c34ad3e3e67b9b127b52d3066937e95c07087ca310a51f36`.
It is distinct from the earlier `07b52742` / `6768` correctness artifact.
Later document metadata carries evidence at these actual pins; it does not
relabel a binary or claim another build.

All 16 existing official candidate-WIDE rows completed: 15 PASS and only the
original accepted on-device SKIP. Evidence seal `8bb085f2` covers 103 files
and 65,771,143 bytes; Root independently verified its full streams, terminal
statuses, physical inputs, artifact/source identities and ended unit. This
is the existing policy's green verdict, not a claim every function executed.
Retained partials, named refusals, platform SKIPs and child-crash records
remain in the raw evidence. General integrity measured 1440/1441 projects
with the intentional invalid-input skip and no violation beyond 82 known;
runtime integrity measured 29/29 with no violation beyond 147 known.
DEX recorded 844 dexed, zero refused/backend declines and 25,219 methods.
Interop ran 47 projects and retained 25 existing Apple/Windows SKIPs.
The compile-time step's 1.05x instruction-count context includes one absent
count and is not the scoped timing result below. No floor, selector,
allowance, known list, skip policy or timing rule changed.

An unshipped owned-only helper at `0c90ab886` / binary `39b677fd` supplied
untimed native metadata. All four helper/plain stdout (except the elapsed
statistic), stderr, status and snapshot-digest pairs agree. It adds no native
query and is never a timed arm. The native counters are captured-fact counts,
not independent executed-query telemetry; selected-call projections are
structural and raw IDs stay local. Its provenance remains separate from
production `661c`. The untimed native seal is `e7052204`; the React build,
copy and qualification seal is `e45d400c`. Existing Go helper/facts were reused
with exact checker/artifact/source-content checks, including all 274 saved
physical source digests. The pre-existing three-file checker-source carry and
compiled checker `4878` were preserved without cleanup or rebuild.

The timing arms are sealed production Go `9c25eda6` at `ecdc7041` and native
`661cd8b0` at `3a04214b`. Five production rows ran once with 10 native samples
bracketed by 11 Go samples, plus one untimed warmup per arm/cell. Go frontend
commands include both `--decompose --calls`. Hello and strings emit-c rows
produce identical nonempty C (960 and 66,714 bytes) and empty stderr. Their
question is identical-C-output task latency. Frontend rows ask the cost of
the complete requested capture operation, with actual representation/count
differences retained, not equal internal query work. Strings has 77 native
versus 169 Go signatures and 175 versus 171 export-reached types; its 92
selected structural call records agree. Reconciler produces the same complete
170 diagnostic lines after ordering, with declared Go exit 1 and native
exit 2; it is diagnostic-operation latency, not compilation success or
compiled coverage. Fs remains UNQUALIFIED and UNSAMPLED because its actual
C/refusal/contract/reach observations differ. No replacement workload was used.

Three complete React suites (2 + 2 + 6 names) ran once with five native
samples bracketed by six Go samples per suite, plus one warmup per arm.
Actual old binaries `01fb8b32` / `437f2f3a` / `11579282` were built in the
`nts-dev` profile at exact `ecdc7041`; native copies `f6381ce3` / `e0ea0a1f` /
`7ca86c4c` retain validated `07b52742` provenance with source byte-equivalent
to `3a04214b`. No overwritten or unproven target candidate was timed.
All actual names/statuses/output predicates passed with zero ignored,
filtered or failed tests and empty stderr. These are affected whole-suite
operation costs. Old Session/full-snapshot and native inspect paths differ,
and 25 old versus 28 new fixture blobs include intentional untyped controls.
The existing assertions establish their specific output predicates, not
complete unprinted transformed-output equality or equal checker work.

The unchanged driver retains every raw adjacent N/G-before and N/G-after
ratio, geometric bracket, full range and median. It prospectively marks a row
INCONCLUSIVE when full Go spread or endpoint drift exceeds 5%; this rule was
not relaxed. All measurements used the official ancestor-held CPU 4 lock,
its CPU 4/5 quiet wait, explicit CPU 4 placement, 16G/swap0/nice19 and existing
14/12/14 GiB admission. No retry, noise rescue, per-name React timing block
or PMU sampling ran. All 154 invocation records (138 measured and 16 warmups)
passed the required output/status/accounting checks. Four production rows
remain INCONCLUSIVE; their raw observations are retained without an accepted
performance conclusion.

| Operation | Wall verdict / median N/G | Median CPU seconds, Go/native | Median peak-process KiB, Go/native |
| --- | --- | ---: | ---: |
| Hello emit-c | INCONCLUSIVE | 0.03 / 0.01 | 46252 / 29434 |
| Strings emit-c | INCONCLUSIVE | 0.06 / 0.02 | 54316 / 31740 |
| Hello capture | INCONCLUSIVE | 0.03 / 0.00 | 46432 / 29128 |
| Strings capture | INCONCLUSIVE | 0.04 / 0.01 | 54572 / 30518 |
| Reconciler diagnostics | MEASURED / 0.225848 | 1.26 / 0.28 | 290280 / 115196 |
| React children table | MEASURED / 0.161005 | 1.01 / 0.15 | 229228 / 50352 |
| React stage | MEASURED / 0.704711 | 0.07 / 0.05 | 42828 / 46824 |
| React transform | MEASURED / 0.869043 | 0.40 / 0.35 | 75114 / 99592 |

For the four MEASURED rows, the unions of both adjacent N/G bound ranges are
0.221477–0.241522 (diagnostics), 0.159768–0.172095 (children table),
0.664242–0.724549 (stage) and 0.856126–0.877684 (transform), all below one.
The CPU values are GNUtime user+system including waited-for descendants,
with 0.01-second display quantization; a displayed 0.00 is not zero work.
RSS is peak-process evidence, not concurrent process-tree aggregate.
Stage and transform's higher native peak-process RSS (46,824 versus 42,828,
and 99,592 versus 75,114 KiB) is a real recorded tradeoff; it does not prove
the same percentage total-memory change. No blanket cost, throughput or
global-memory claim follows from these rows.

The actual production measurement seal is
`8a4fb16fb51ecb0f6ca452b0f389a68737d85462ed1733676f8f4b5a8a3e6e1c`
(472 files / 4,904,182 bytes); React is
`95f3c572f414a1d5af6d069c5f66f09e10dda37d147b2192444d99d23cd1f754`
(168 files / 1,931,118 bytes). Root independently rehashed all 640 files and
3465 inputs per mode, recomputed all ratios/spreads/endpoints/verdicts, and
verified both units ended with no main PID/control group and released lock.
Its measurement audit is `7fa6914622f4d782daa40e70a40cab4718185af9b2b246425b67674786b22729`.
The candidate-WIDE seal's full SHA is
`8bb085f2a0d209b08f8db65f0358a4e6c0ec7c8e9d4eac4657ae656067325bfe`.
All files remain under `~/.cache/nts-scratch/tsrs-lane/`; measured source and
artifact pins are preserved in their manifests and raw output.

The historical runtime `50f540ad` at `a54f` / `e713` still has actual consumer
exit 1 and explicit `AbortSignalLike.addEventListener` own refusal, with no
prepared executable caller/body/result ABI restored. The green current
integrity judgment and these diagnostic/factory-discard measurements do not
supply that coverage. Historical WIDE reds, workspace101, prior JVM decline
and all partial/declined/unreached evidence remain separate at their true pins.

The historical V14 metadata reconciliation at `f7d49716` changed only this
record, preserving atomic47 and Project48 and all eight compiled-group Git
objects/modes of measured `3a04214b`. Its then-current 759-program/76-interop
catalog and 56 typed-Name/four Program-reference inventory carried by exact
source identity. Root's official dry-run source checks on `3a04214b` passed
all seven lightweight rows; its printed existing `6768` release was
source-check context only. The later V14 full-gate failure and V15 repairs
below are separate evidence; this historical carry does not validate their
changed compiler source or transfer these performance conclusions.

### V15 reviewed repairs and validation still owed

The reviewed repair checkpoint is `26b276c74048743779df42bce477cde271a4449e`,
tree `4cee6c207efbf97c4c362a973c2cbb3cdb89584c`. The source-only final
proposal removes the temporary owned-state recorder/dev dependency and updates
this record. Its private file projections and series replay are review inputs,
not a landed commit or a new compiler. Main remains `b22504de`.

The original V14 full landing gate at `f7d49716` remains RED/NOTLANDED,
sealed in `04303bb7`: 51 terminal rows, 36 PASS, 14 FAIL and the original
accepted on-device SKIP. Every failed row exited 1. Eleven have empty log and
timing files, so their execution details/populations are unavailable; earlier
workspace results cannot fill them. The other failures were the types reader,
JVM verification and interop. Four interop projects explicitly report ENOSPC;
five lack a verdict. Disk failure there does not classify all missing output
or the JVM findings. Actual service failure and collection-entry success are
separate facts. The failed run and all original streams remain sealed.

A retained accepted Go-based gate at `ecdc7041` has JVM exit 0 with runtime
26983/26991 over 29/29 projects and outcomes 2428/2428 over 280/280. Its three
runtime known rows are child_process, cluster and perf_hooks, not stream,
zlib or crypto. That source differs from main `b22504de` only in docs/wasm.md;
the Java verifier and known table are unchanged through the repair source.
This is historical baseline evidence, not a fresh matched comparison or proof
of the precise change that introduced the current missing-class findings.

The repaired type consumer recognizes UniqueSymbol and NonPrimitive and
preserves typed Name, Private and Symbol identities. Unknown/malformed keys
and invalid Rust Debug escapes fail closed. Its old-compiler 29/759 census
is separate evidence. JVM diagnostic tooling now retains failed classes,
full errors and authoritative child statuses. Reviewed compiler changes carry
semantic raising-slot identity, canonicalize only proven owned identity
forwarders, lower native arguments under the actual selected binding and
request reached native-overload callback parameter types within the unchanged
capture budget. Written Optional/Erased implementation authority yields explicit
Undefined tail operands and complete adapter keys; strict literal admission,
absence conversions and unproved distinct-body refusals stay conservative.
These changes add real analysis and lookup work, with no new-source timing claim.

The optional-tail focused seal `2ef7aa29` has five zero-status steps and
sixteen passing tests. Its saved adapter has two inputs and calls the original
three-operand body with a distinct Erased ConstUndefined value; emitted code
loads the undefined runtime value. Earlier no-implementer and missing-Child
RED attempts remain at their actual pins. This is producer/class coherence,
not a runtime-corpus result.

The release-prefix seal `969d376d` binds format/default workspace all-target
strict checks and one plain workspace release build at `3a5b1860`. Four actual
release roles were copied/sealed before dependent tests. Compiler
`5f3628326dedb0b38e3b2b848901e7ad43918d687689653983858d591520bb4e`
and manifest
`1e56d62753554fe8ea5a86eafa127290794100792fe653aa3b09a95149ea347f`
keep that source/tree/profile; later Rust test binaries are distinct artifacts.

The original 23-command renewal stopped at command nine, seal `ab08de90`.
Its eight optional subject/control cells on C/LLVM/JVM/Wasm each executed
58 numeric cases/two scalar exports with complete matching native/Node maps.
Array-taking helper exports remain nondrivable directly. The named-JVM command
then returned 1: crypto 1888/1894, zlib 1530/1538 and stream 1483/1487 classes
verified, total 4901/4919, zero invalid and eighteen missing-class findings.
All three emission and verifier subprocesses returned zero; the official tool
reported the findings. These are not asserted to be eighteen distinct missing
definitions. Full failed directories, declines, streams and seen-record hashes
remain retained. No missing-class or known-list exception is granted.

The independent fourteen-command continuation at the same `3a5b`/`5f` pin
also stopped, seal `87866077`. Eight actual child commands returned zero:
two native-default neighbours with active emitted go-body calls, full workspace
2415 PASS/0 FAIL/8 ignored across 318 groups, capture 761, composition 837,
types runtime 29/29 and programs 761/761, and blockers 402. Runtime types
measured 301087 types/122973 signatures/1582 members; programs measured
42423/13088/40. Blockers had 237 reproduced refusals, 161 existing guards,
three FIXED rows and one CHANGED, which retained policy RED. Outcomes and the
five C Test262 recorded commands remained unstarted. The continuation does
not establish combined 23-command success or named-JVM clearance.

The CHANGED literal-interface callback fixture separately emitted twelve
classes with status 0/empty stderr (`179ee5d2`) and passed the official JVM
check against Node on 29 cases/one scalar function (`bffa8dfc`). The old helper
recognized only “nothing refused” as clean, so a normal JVM completion could
fall through to CHANGED. Its reviewed fix retains full child status/streams
before judgment and requires status 0, no signal/error, literally empty stderr
and a complete positive class-count/path summary. Original refusal predicates
and expectations stay unchanged. Existing FIXED progress policy is preserved;
the original 402 policy RED is not rewritten or equated with execution success.

Two other reviewed metadata migrations remain narrow: the exact typed accessor
spelling and actual compiler provenance in one saved outcome, and the Nest
fixture's precise own-source refusal reason. The former is no global function
name normalization; ordinary same-looking public names stay distinct. The
latter preserves all executable TypeScript bytes and the original commented
pseudocode. Actual partial Nest evidence remains 4096 types, zero functions
and 2045 refusals; its reason matcher does not guarantee that population or
claim a nesting fix. The original outcome policy RED and earlier private
comment-insertion error remain retained.

Owned crypto recorder evidence `4636b4e6` and reuse-focused `c19afef2` keep
complete before/after Programs and chosen contracts. Exact owner/original/
chosen-contract reuse reduces duplicate stops for Transform and Sign to one
each, while distinct Duplex originals/contracts/reasons retain two. The saved
before-settle/before-guard Programs and identity-edge files are byte-identical
across that narrow repair. Fewer duplicate Funcs are not lost support or a
performance result, and stale/missing projection endpoints grant no identity.

The additive dispatch seal `d0e5e4b8` at `f1c211d3` has six actual zero rows
and 24 passing tests. Optional GuardedDispatch provenance is revalidated against
live contract, receiver, slot and exact named-stop facts; dead/retargeted proof
is pruned. Only the certified two-row Void class/interface conflict gets a
separate internal selector. Existing public names/descriptors stay; an added internal default
on an interface forwards through its unchanged abstract public declaration. Concrete interface rows,
unproved populations, field-family/uniform/foreign boundaries and missing
identity edges retain conservative behavior. The bridge ownership plan is tested
in both logical slot orders. Two javac and three Java invocations have retained
actual status/argv/PID/streams and complete class sets. Old implementation AND
old driver binaries were compiled against the old-ABI control and copied
byte-identically to the new set; the same old driver passes both. The new driver
reaches distinct named class/interface stops. Initial lifetime and test-borrow
strict failures remain sealed; no exception-runtime or runtime3 claim follows.

Opaque-face focused seal `4e62be1c` at `26b276c7` has four zero rows and
14 PASS/0 FAIL/0 ignored/no legacy SKIP. Published missing-field defaults and
their actual distinct co-located receivers allow unrelated materialized family
rows without turning an otherwise opaque specialization into the shared
layout's nominal class. Ordinary/unknown/unpublished/missing/own/outside/
nonobject/foreign/state/base/nominal/own-family cases stay conservative. The
shared object-reference path changes newly eligible public argument/result/
field descriptors and frames to java/lang/Object: this is an explicit ABI
representation change. Saved returned/received code is 2ab0, store code is
2a2bb50012b1, Holder's field is Object and diagnostics are empty; the nominal
control retains its class. The executed Body.locals/vtype assertion passed,
without a separate explicit frame artifact or general owned-class execution
claim. Six new owned tests add no snapshot/JDK call. The eight unchanged
snapshot calls may reuse cached answers; producer launches are not inferred.
Legacy tests assert two javac/two Java/one javap successes, but delete successful
scratch and do not retain separate child streams/classes. That limitation is
explicit. The first style-only strict failure remains sealed.

Root and compiler owner independently accepted both focused bundles only in
these stated scopes. They do not renew the actual CLI, runtime3, FormData
runtime behavior, broader corpora or performance. The source-only final
omission proposal removes just the temporary recorder registration, three
observations, replacement hook, module and core dev-only JVM dependency/lock
edge. GuardedDispatch, reuse/proofs/pruning and 22 permanent source files are
protected. Historical diagnostic commits, test binaries and sealed evidence
remain available; omission and series application require exact source review.

The current map/catalog and projected omission/doc tree are rederived in the
review packet rather than copied from old 922/56/759 constants. The recursive
catalog remains 761 programs plus 76 interop configs (837). All 60 prior typed
Name sites remain byte-identical at their actual paths, with four new test-only
constructors; the four Program-reference sites are unchanged. The schema
46 → atomic47 → Project48 → docs48 plan retains exact historical Project edits
through an explicit private reverse/forward replay. New commit IDs and landing
acceptance are not inferred from those source projections.

Final-source validation still owes default workspace strict checks, ONE plain
workspace release before dependent tests and four sealed actual binaries,
early optional backend/runtime3/native-neighbour checks, full workspace with
explicit fresh NTS_BIN, capture/composition, types 29/761, original blockers/
outcomes and five C Test262 records. One official owed FULL51 landing gate
then supplies the combined core/WIDE verdict; no duplicate candidate16WIDE or
new performance run is proposed. Keep targets warm through fix/preflight;
reviewed idle-owned cleanup and a fresh measured 130 GiB admission guard precede
the gate. That guard already includes reserve over observed 106.55 GiB debug
growth. No guard, selector, floor, known, record data or timing policy is waived.

Historical `3a04214b`/`661c` WIDE and scoped measurement results retain their
actual pins: four production rows INCONCLUSIVE, fs UNSAMPLED and peak-process
RSS tradeoffs, without equal-query-work or global-memory claims. The historical
`a54f`/`e713` runtime consumer remains actual exit 1 with explicit own refusal
and no restored executable caller/body/result ABI. These are not new-source
validation or timing evidence. Main is not landed at this checkpoint.

### V16 split-face checkpoint and final-source renewal

The final V16 candidate `0c23328c143bd70c8a55179854f4e0609cfc0e1b`
(`d6f84b914f38f5125af53a79f222ee506890a258`) received its own plain workspace
release build after formatting and default-profile strict checking. Its copied
compiler is `0dd379b92eb3ca7867ce9cfb74b3da612e83be156020431592026ad1e3cc7b9a`,
with four release roles sealed by manifest
`51f6c8500b76cf654740d2863e338c5f0f00f1bc030ad22724af0006bc17ab58`.
These identities belong to that candidate, rather than to the later repair.

Its 23-command renewal stopped on the ninth command. Both optional-tail fixture
configs agreed with Node on C, LLVM, JVM and Wasm: each of the eight checks
executed 29 cases for each scalar `subject` and `control`, with complete numeric
result maps. The array-taking helpers remained directly nondrivable. The named
JVM runtime check then exited 1: 4,940 of 4,946 classes verified across all three
projects, with zero invalid classes, six missing-class findings through
`DuplexSide`, and one unclassified `_destroy` dispatch shape. The compiler emit
and Java verifier subprocesses each exited 0; the conformance tool's exit 1 is
the actual policy result. The stopped bundle
`final-v16-renewal-evidence.json`, SHA256
`495c2abc39e41936f0fcd3add8a1c49a18acbed4ac7ec3c1f218dbcceb55a903`, remains
PARTIAL RED. Its later fourteen commands never started in that invocation.

A separate, explicitly reviewed invocation ran only those fourteen unstarted
commands at the same `0c23328c` source and `0dd379b9` compiler. Both native-default
neighbors retained the expected calls inside their emitted `go` bodies. The
workspace result was 2,436 passed, zero failed and eight ignored across 318
groups; capture covered 761 programs, composition covered 837 unique configs,
and both type-reader populations completed (runtime 29/29 and programs
761/761). All 402 blockers and 280 outcomes met the existing policies, including
four permitted FIXED cases in each corpus. The five C Test262 records covered
8,369 language, 1,034 builtins, 12 Annex B, 58 staging and 17 harness cases;
all seven reconciliation difference counts were zero, and the existing floors
and ceilings were unchanged. This independent fourteen-command bundle is
`final-v16-independent14-evidence.json`, SHA256
`5ce2c531133de7a0b1c56238b97657d68e7fbb179da8c989206523cd2458cab0`.
It does not turn the stopped JVM command into a pass or establish all-23 success.

The subsequent six-path JVM repair and its two comment-only lint corrections
are committed at `1b261f4caf2403e47d7cdc7c23f7d30efe7c411f`
(`993a25b673c9fce7f35f1acd832a93bcc5e54452`). The certified two-row Void stop
boundary remains intact. Stateful split faces retain both public abstract
surfaces and concrete internal class wrappers; one internal interface default
belongs to the unique ancestor selected from the parent graph actually emitted.
Descendants inherit it without an abstract or concrete internal redeclaration.
Distinct roots, even with the same Func, and cycles deny that additional name.
No body or descriptor equality substitutes for the existing owned certificate.

The first focused attempt at `05ff83c2` passed formatting and exited 101 during
strict checking for two documentation backticks; no test or Java control ran.
After the exact owner-reviewed comment correction, the five-command focused
attempt at `1b261f4c` passed formatting, default-profile JVM strict checking and
all 28 tests (19 guarded-member, four identity and five existing regressions).
The five existing `Frontend.snapshot` call sites are not a count of producer
launches; cached answers may be reused. New owned controls make no snapshot.
All five javac and eight Java child invocations exited 0, with their complete
streams and statuses retained. Seven old implementer/subclass/caller binary
pairs were copied unchanged, including the sibling-companion implementer and
its root-call driver. The old-ABI controls use the same current emitter without
the refused receiver; they are not executions of a historical compiler.
Direct/transitive diamonds, both layout orders and the retained Callable
descriptor passed executed assertions; separate class sets are not claimed for
every in-memory assertion. This focused bundle is
`guarded-split-face-focused-v16-attempt2-evidence.json`, SHA256
`90b77cfceea12eaeb003244fa4ae8aab9bf6f31c1380a114467d705ef86310be`.
Root and compiler-owner reviews accept only this source/owned/JDK coherence
scope. All recorded processes ended; the two journal records have no explicit
terminal EXIT row, so collected service defaults are not independent status proof.

The six JVM paths are the only compiled-source difference from `0c23328c`.
The temporary recorder, its cfg(test) hooks and the core-to-JVM development
dependency remain omitted. The source-only proposal retains the atomic47,
Project48 and documentation48 schema ancestry, and replays the historical
24-path Project migration on the repaired bytes. Its source map and typed-name
inventory are rederived; historical counts are not reused as current counts.

Fresh CLI verification of this repaired source is still owed. The next dependent
checkpoint is one fresh plain workspace release with all four roles sealed,
then the actual named JVM runtime three first, stopping on an unexpected
status, partial population or policy failure. Current repaired-CLI proof
membership and runtime restoration remain unobserved. The older JVM RED and
the independent fourteen-command PASS keep their true pins. The eventual
official owed full gate supplies the combined wide/core verdict after causes
and prerequisites are addressed; no duplicate separate WIDE, automatic repeat
of the fourteen commands, retry, selector waiver or policy change is implied.
Its fresh 130 GiB disk admission remains required after reviewed idle-owned
cleanup. Main is not landed. The earlier performance limits (four INCONCLUSIVE
production rows, fs UNSAMPLED, peak-process RSS tradeoffs), absence of equal
internal-query-work evidence and historical runtime consumer status 1 remain
unchanged; none is a performance or runtime-ABI claim for the repaired source.

### V18 public overrides, class contracts and measured repair checkpoint

The repaired compiler has now completed the original named JVM class-verification
check for stream, zlib and crypto. Its actual build source is
`496e3e3318108433ab9b553954ac55ef89903105`, tree
`0fae4b1f4d6c6ba7472b0737db14e90aedc36ac6`. Formatting, default-profile workspace
all-target strict checking and ONE plain `cargo build --release --jobs 4` all
exited 0. The four copied release roles have mode 0555 and the provenance
manifest has mode 0444. The compiler SHA256 is
`1003d25ec64ecad7167935af11dfafacc33c35d7c8c97a241faffbf9298de3a1`; its manifest is
`3abe1db5b6534c959f5398eb3536721ce3fa9687cab58ff3cfd87592773bdbb1`.
The release-prefix evidence is `repair-v18-release-prefix-evidence.json`, SHA256
`1625810e0736f59ab6ea6dd101e4c7e5ab9ac3cee2e96f567f9333e22788b196`.

The separately authorized original Node conformance command selected only
`runtime/node/stream`, `runtime/node/zlib` and `runtime/node/crypto`, with
`NTS_JVM_VERIFIES_JOBS=1`, the fresh sealed compiler and unchanged known tables,
Java verifier, status checks and dispatch classification policy. It exited 0
without a signal in 110.397 seconds, with empty stderr: 4,949 of 4,949 classes
verified across 3 of 3 projects, zero known failures, zero pinned failures and
every JVM dispatch decline classified. All four old/new seen-record states
remained unchanged; the two existing full records were copied. This is evidence
of class verification and linkage for those selected projects, not execution
of every runtime export or the full 29-project runtime population. The unchanged
official tool deleted successful scratch. Successful class sets, per-project
JDK raw files, all child PIDs and a real-CLI internal selector/map inventory
are therefore not claimed. The controller, Node child and one observed emitter
PID ended, and the unit was inactive with an empty cgroup. Actual command status
and official population/policy output are primary; the two journal rows contain
no explicit terminal EXIT, and collected defaults are not independent proof.
The evidence is `repair-v18-jvm-runtime-evidence.json`, SHA256
`097a6bd3c1827a89f6d34a077b66adb33795025de23420b02e983460784596ac`.
Root and compiler-owner reviews independently accepted this measured scope.

The earlier `91210fb1`/`92a499df` named check remains an actual RED: 4,940 of
4,946 classes verified, with six missing-class findings. Its raw `_final`
conflicts were crypto slots 97/102 and stream/zlib slots 96/101, distinct from
the older `_destroy` 83/88 finding despite equal totals. Its evidence
`final-v17-jvm-runtime-evidence.json`, SHA256
`9793bf3c00bd6a1d5f0c940e674772f05fbc1fc219e0d236d1759051a7d40bb3`, is not
retargeted. The retained accepted Go baseline also remains at its original pin;
no fresh matched Go/native pair or precise introducing-commit attribution is
inferred from this selected verification repair.

Two public-override controls exposed additional ABI defects before their fixes.
An old Java subclass of a healthy nonfinal concrete Good class overrides only
the unchanged public plain member. Adding the unrelated refused receiver made
its internal alias bypass that override: the ordinary control produced 307
instead of 1,000 (`1272f125` evidence), and a legal coherent certified one-stop
variant threw `NtsRefusal` instead (`487c250a`). Both original old Java arms
passed, and both old implementer/caller binary pairs were independently equal
across each control/subject. The repair consults the complete existing public
forwarding plan: an alias whose plain member and descriptor have the same
canonical target owner calls that plain member virtually, including a coherent
named stop. A different Bad stop owner retains its direct static body. Neither
proof presence, body-byte equality nor a name prefix substitutes for ownership.
At `22e06327`, all 30 focused tests and 7 javac/12 Java invocations passed; the
ordinary and coherent Good wrappers used `invokevirtual Good.step`, while the
two Bad stop targets and reasons remained distinct. This was a narrow public
ABI repair, not class-contract or broad runtime acceptance.

An ordinary abstract physical implementer had separately redeclared the new
internal method abstract and shadowed the concrete interface default. Its old
plain-only subclass and unchanged driver passed the control then failed the
subject with `AbstractMethodError` on old production (`9589a534` evidence).
The class-contract work gives such physical abstract implementers a concrete
virtual wrapper through their unchanged public member, and extends the cached
additional-member authority to a unique owned source-interface contract that
remains a physical class. Identity, whole declared ancestry, actual live
abstract receiver ownership, exact ABI, complete-family and existing stop
certificates remain required. Foreign, nominal, unknown, ambiguous, mixed and
unproved cyclic authorities deny the additional selector. This method-spelling
authority does not create JVM class inheritance, store assignability or field
views. Production physical classification, cast/store checks and the distinct
stop reasons remain unchanged.

The first owned class-contract fixture did not create the intended collision:
its healthy rows retained different `step` and `step$Face` spellings at the same
Callable ABI. The `a4ba03a4` 22-pass/5-fail attempt remains actual PARTIAL RED.
The test-only correction follows the already-proved identity-projection target
for healthy Base/Good rows and adds actual same-member/descriptor/no-raising
premises. On old production those premises passed before the missing selector
failed (`29660ec0`, zero emission/query/Java). The corrected after attempt then
passed all positive class-contract and old-binary execution controls, but two
negative obligations were wrong: a same-layout semantic self-edge was not an
emitted graph cycle, and a declined conversion correctly retained a named
refusal stub. That `2536628f` attempt remains 25 passed/2 failed; its shared
helper did not identify the failed identity subcase, and its second FieldView
iteration and later nine tests did not run. No unsaved negative class bytes
are inferred.

The final test-only negative correction uses two distinct fielded layouts with
2->21->2 ancestry and explicit noninterface/nonsplit/unproved-chain premises,
plus labeled subcases. Store and FieldView inputs and refusal obligations are
preserved. Their retained output now requires the exact Bad->Face public static
synthetic method and named diagnostic, then actual verify-all Java reflection
must throw the exact named `NtsRefusal` with the full reason; successful return,
`ClassCastException` or any other failure does not pass. Both actual saved stubs
load the diagnostic, call `NtsRuntime.refused(String)`, then execute
`aconst_null; athrow`. One reflection driver was compiled once and copied
unchanged between these two negative outputs. That shared driver pair is
separate from the old ABI pairs.

At measured `496e3e33`, all five focused commands exited 0: 27 guarded-member,
four identity and five existing field/structural/throwing tests, for 36 passed,
zero failed and zero ignored. The five unchanged snapshot call sites ran; they
do not establish a count of physical producer launches. New owned controls make
no frontend snapshot or preparation. All 11 javac and 19 Java invocations
exited 0. Nine artifact roots retain 308 original/copy files, 15 old ABI pairs
are byte-equal, and the additional shared reflection-driver pair is byte-equal.
Four actual CargoRunning test executables and provenance were copied, and all
38 recorded PIDs ended. Root and owner independently verified this focused
bundle: `class-contract-negative-controls-v3-evidence.json`, SHA256
`697eba5d5e3213449907fbbc794eefd97015d5a41859dadec862ead551e51ecc`.
The cycle result is executed assertion evidence, not a separately saved cycle
Program. The named JVM result above supplies the subsequent fresh CLI checkpoint.

After the last needed diagnostic evidence, exact source reviews authorized
only the temporary JVM witness omission. Commit
`3c81aed2236a4af46d3626357fc9285e960dfe4c` has tree
`ef163c627bfd0e4f1d6694ffa076c6568212c7b1` and changes only three paths:
the cfg(test) registration, the diagnostic child deletion, and its sole
cfg(test) `guarded_kind` observer accessor. Production `Member.kind`,
`guarded_default`, class-contract ownership, Good forwarding and all 96
permanent control files are unchanged. The earlier core recorder/development
cycle omission and Cargo bytes remain intact. Both actual omission readbacks
match the reviewed projection. This omission commit is unbuilt and untested;
the measured release and JVM evidence remain explicitly at `496e`/`1003`.
The final source-only documentation/three-tree projection will be reviewed
before any shaping. Its typed Name occurrences, source coordinates, complete
config catalog, compiled groups and actual 24-path Project replay are rederived,
while preserving the schema 46->47->48->48 ancestry and old evidence coordinates.

The earlier fourteen-command PASS remains at `0c23328c`/`0dd379b9`, and the old
V14 full-gate RED, all technical attempts, the runtime-consumer exit 1 and all
performance qualifications remain historical facts. No automatic fourteen-command
repeat, duplicate WIDE or performance run is implied. The official owed full
gate must build and test the final candidate and supply its combined verdict.
Its fresh actual 130 GiB free-space admission remains required after separately
reviewed idle-owned cleanup; that floor already includes reserve over observed
106.55 GiB debug growth. No file is deleted by a source-preparation docket, and
no hypothetical reclaimed total is an admission measurement. Reader permission
denials stay qualified rather than becoming a universal zero-reader claim.
Main remains `b22504de` and is not landed. Four production performance rows remain
INCONCLUSIVE, fs UNSAMPLED and peak-process RSS tradeoffs unpriced for this
repair; class counts do not establish equal internal query work or a global
memory/performance result.

## V19: bounded binary lowering and the actual new-artifact value control

The measured repair source is `6116dd7129bb2ecb52cf2bc63a4058686c31f604`, tree `77a0127e49d3d033bdc006ab86b7421130fe0bcc`. Its fresh plain workspace release produced compiler SHA-256 `6f77d84b9e3a8f5218cd0a1c68721b386b1c74ffd65abda04492e14e8d069279` and four-role provenance `1ca8643c9977c1afe3c6375b8d2850c38fa3085d8f1e71004cb0b257f4a44d93`. These source and artifact identities remain the evidence pins. A later clean three-commit projection is a different candidate, and has not inherited their measurements or a green gate.

The previous official FULL51 gate at `56bfa8542d87ea0d3940e125e904f9cb7e06b4e5` ended with 48 passing steps, two failures, and one accepted device skip. Main remained `b22504de174f6e888aee8492eaed37c9470bd84e`. One failure was a suite SIGABRT; the other was an unclassified JVM-only FormData iterator store. Neither historical result is rewritten by the subsequent work.

The saved suite core establishes stack-overflow handling on the lowering worker and binds the active input to the existing deep-chain fixture. A separate observer-only invocation retained the actual owned syntax arena before lowering and reproduced the abort on the original 8 MiB worker. Independent graph readers traversed all 19,355 nodes and 19,354 child edges: a finite acyclic tree, with direct binary chains of 1,499 numeric additions and 4,949 empty-string additions. This rules out cyclic syntax child or operand input for that owned invocation. It does not identify the introducing commit or reconstruct a previous compiler's snapshot.

The production change in `compiler/core/src/hir/lower.rs` replaces recursion through ordinary direct binary operands with explicit pending continuations. It preserves operand visitation order, association, original node identities, conversion ordering, diagnostics and the extracted special-prefix/value-tail paths. The worker stays at 8 MiB. The pending storage is proportional to direct binary depth; other special-handler and wrapper recursion remains on its existing paths. No general performance or arbitrary syntax-depth claim follows.

The focused after run at `e693e184a37113256068e0113d1c9d0f3f7512f8` passed the canonical format command, strict core/suite compilation and four exact Rust tests. The existing deep-chain test passed on its original worker; the retained node-record stream was byte-identical to the owned before stream. The full raw snapshots differed, so whole-snapshot identity is not claimed. The suite permits backend refusal notes: its Rust pass establishes fit and the existing HIR/totals assertions, not complete C/JVM emission or independently retained statuses for every internal child.

The permanent six-export fixture at `tests/programs/a-binary-chain-keeps-evaluation-and-conversion-order/` checks operand effects, association, direct right operands, mixed trees and a throwing conversion. An actual old compiler control (`9c525083…`, source `56bfa…`, fixture input source `76e6…`) reached all six exports over the existing 29-value numeric pool. Its 174 native C results agreed with Node, including trace strings and caught errors. This is a compatibility baseline, not a counterexample to the stack overflow; the existing deep-chain test supplies that counterexample.

After diagnostic observer removal, source `6116…` passed `cargo fmt --check`, the full workspace all-target strict command and one plain workspace release build. The actual newly built `6f77…` compiler then ran one existing C/clang/native-plus-Node check of the unchanged six-export fixture. All 174 actual cases, argument bit patterns, result order, UTF-16 values and both `done 174` markers passed, with the CLI's full-population agreement lines. A separate saved-only parser confirmed the result, and the new full C/Node driver files and result files equal the accepted old control. The CLI exited zero without a signal. Successful internal helper child statuses are not independently exposed; sampled PIDs and two journal messages do not supply a complete transient-child inventory or an explicit terminal EXIT record.

The narrow JVM policy change adds one `jvm-only` known-decline row for `FormDataIterator<N> -> IterableIterator<N>`. Saved emitted classes show the exact target `EventTargetLike$Face` has no fields or live slots, matching the existing URLSearchParams and ReadableStream empty-target policy. The JVM still refuses the named store. This classification adds no assignability, store, cast, nominal, certificate or ownership permission. The private assignability witness remains deferred and unapplied; a new official gate must judge the updated row.

The temporary suite observer registration, false match arm and child are absent. The whole suite main is byte-identical to the clean `56bfa…` baseline; the permanent deep-chain test and original worker remain. Final landed ancestry must start from main and omit diagnostic add/adjust/remove commits, including `c50c…`, `bdda…` and `6116…`, while preserving their refs and immutable evidence. The clean pre-document projection must equal tree `77a0127e…`; only the separately reviewed final document projection may differ. The atomic schema-47 and 24-path ProjectSemantics schema-48 split remains explicit; documentation does not bump schema 48.

The catalog and source-site map are freshly derived from the current clean tree, including the added fixture config and moved lowering coordinates. Historical list sizes and line numbers are not reused as current facts. The older focused JVM controls, selected stream/zlib/crypto class verification, independent fourteen-check pin, failure controls and inconclusive performance record keep their original source and artifact pins.

Still owed are the canonical inner checks over the touched root-workspace crates and all four backend crates, the five recorded C test262 sets (language, builtins, annexB, staging, harness), final owner/coordinator review and clean shaping, and the official gate on the actual final SHA. Resource admission requires measured working capacity and the actual 130 GiB gate floor after protected-content exclusions; cache census sums alone are not admission. No extra wide sweep, repeated independent fourteen, performance result, landing clearance or green main is inferred from the focused or value-control passes.
