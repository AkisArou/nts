# Shared ECMAScript builtins

Date, Temporal and Intl architecture, implementation stages and validation are
tracked in [DATE-TEMPORAL-INTL.md](DATE-TEMPORAL-INTL.md). Their calendar/exact-time
core shares TypeScript semantics; ICU providers supply typed data primitives.
Date and Temporal values own their state in typed private fields. Class
declarations stay plain; standard inputs, options and results use the pinned
TypeScript libraries directly. The type audit in
that document records the remaining RegExp facade rewrite and compiler gaps for
canonical Temporal unions. Host results do not establish that public exports
compile under NTS's typed object model. No WeakMap is needed for these values.

Non-ISO calendar foundations now include shared arithmetic, era/month-code
rules, validated year snapshots and a bounded cache, with public ICU C/JVM data
cursors for the remaining calendars. All five calendar-bearing values and
Duration-relative operations use resolved contexts for non-ISO fields,
arithmetic, differences and conversions. The complete original Intl Temporal
host suite passes 2,029/2,029. Licensed, pinned Chinese/Korean year tables fix
independently reproduced ICU data defects; their TS generator verifies hashes
and continuity. The compiled table witness passes corrected goldens and 128,635
round trips on every backend/memory configuration. Bounded full-range strategies
and exact month coordinates pass supplementary checks; their actual compiled
strategy/value acceptance remains open. `--calendar` retains three raw-provider
full-range failures. DateTimeFormat still needs calendar fields consistent with
these corrected tables; its independent ICU formatting data has a known mismatch.

Intl number options now normalize in shared TypeScript and produce the same ICU
configuration on C and JVM. Currency precision uses pinned provider data;
formatting reuses its state and buffers. PluralRules shares the digit algorithm
and supports cardinal/ordinal selection, notation, exact inputs and ranges.
ListFormat and RelativeTimeFormat have typed implementations and pinned providers.
DurationFormat now shares Temporal validation, NumberFormat primitives and lazy
list templates, with exact fractions and standard-library parts. Its original
Test262 host result is 101/110; native callback sanitizers and JVM optional part
records still block compiled acceptance. The separate `--duration` ICU gate and
public/parts witnesses retain those failures.
supportedValuesOf now enumerates all six categories with cached shared semantics
and fresh result arrays. Public ICU IANA identity queries supply primary zone
names; NumberFormat shares the same sanctioned-unit table. Its original Test262
host result is 24/25, retaining the excluded descriptor case. DisplayNames now
supports all six standard name types, with shared
validation/canonicalization/fallback and bounded name caches. Its original
Test262 host result is 49/57; canonical locale unions and resolved records still
block public compiled acceptance.
Segmenter now shares typed options, lazy independent cursors, containment and
iteration across public ICU C/Java primitives. Native UTF-16 is borrowed;
Latin-1 uses bounded decoded chunks. The original Test262 host result is 67/79,
and all 766 Unicode 17 grapheme vectors pass on both providers. Boundary/provider
checks pass all five configurations with native sanitizers and JVM verification.
Public locale/record/iterator compilation and common iterator helpers remain open.
Locale now shares ordered calendar/hour/week preference fallback and private lazy
caches. A generated 2,022-byte CLDR payload supplies only availability and hour
ordering absent from public ICU queries; calendar names and week values stay in
ICU. Country zone lists use public IANA identities. The preference/provider
witness passes all five configurations; the public Locale constructor and result
records still have compiler refusals. Original Locale Test262 remains 128/168.
Temporal now shares exact local-time resolution, gap/fold and offset selection,
start-of-day and transition queries. Instant has an original Test262 host result
of 461/465; the ZonedDateTime value class is at 895/901, including all original
field replacement and difference tests. Bounded shared caches retain eight named
handles and two adjacent offset periods per handle. Resolved identifiers retain
both named spelling and IANA primary identity, including Factory. ISO zoned
date addition and rounding now handle variable days and preserve fold offsets. The cache matches public
ICU across all 446 primary zones in the earlier five-configuration checkpoint.
Duration's plain/zoned relative comparison, rounding and totals now share
those kernels. Its original host result is 538/540, including every comparison,
rounding and total case; two metadata failures remain visible.
Removing class `implements` checks exposes a compiler dependency in structural
provider dispatch; the current compiled gate stops before execution. Canonical
public unions also remain compiler dependencies. Temporal.Now now implements
all six operations with injected nanosecond clock/default-zone capabilities and
direct value construction. Its original host result is 56/66, retaining ten
metadata cases. Stored callbacks returning BigInt remain a compiler dependency;
Shared localization now connects all eight Temporal value classes and the three
Date locale methods to Intl through immutable slots. It opens only the selected
formatter and preserves the specified fallback when Intl is absent. All 56
original builtin Temporal locale cases pass both with and without Intl; the
Intl-specific locale slice now passes 97/97 within the complete
2,029/2,029 Intl Temporal checkpoint above.
The full builtin Temporal host result is 4,567/4,603, with all verdicts and failure
reasons unchanged in the calendar integration. Date is at 543/594 and
DateTimeFormat at 217/244. Date's
environment/slot follow-up fixes 149 original cases and retains two new excluded
descriptor failures; its full compiled state witness remains refused. The actual
C/JVM localization witness typechecks but retains compiler refusals for canonical
unions and structural dispatch. Shipping clock/locale bindings, calendar formatting,
complete standard bindings and public conformance remain in progress.
Shared zone fixes skip unchanged-offset rule transitions and round repeated
dates to their first day boundaries. The completed Intl Temporal rerun exercises
both fixes alongside the new non-ISO operations. Host results remain supplementary;
shipping standard builtin execution is required for completion.

## Regexp

The parser, matcher and builtin algorithms have one TypeScript source for native
and JVM targets. JVM execution needs no JNI, Java regex engine or C library.
Compiler binding to the standard `RegExp` and String builtins belongs to the
compiler/backend lanes. Core imports provide the emitted-code integration API;
the generic builtin facade is currently validated on the host.

`src/regexp/engine.ts` exports `compile`, `execute`, `RegexProgram` and
`RegexRunner`. A program owns compiled instructions, character sets and capture
metadata. A runner owns reusable matching buffers. `NtsRegExp` creates a runner
per instance; clones can share code but keep separate runners and `lastIndex`.
The standalone `execute` entry point creates its own runner.

Matching uses an explicit backtracking stack and an undo trail for captures and
repeat registers. Instructions, ranges, stacks and trails use typed arrays.
There is no recursion during matching. Pattern parsing and compilation still
recurse over nested grammar constructs. Literal prefixes use the backend's
string search primitive, and ASCII folding bypasses Unicode decoding.

The implementation supports `dgimsuvy`, UTF-16 offsets, named and numbered
captures, forward references, lookahead and lookbehind, scoped `ims` modifiers,
Unicode properties and `v` set operations and finite strings. Builtin algorithms
cover construction, `exec`, `test`, `escape`, the six regexp symbol methods and
the associated String methods. Captures are allocated to their known size;
builder arrays still use `push` during compilation and for results whose length
is unknown. Backtracking does not copy all capture registers at each choice.

## Unicode data

`../c/quickjs/REVISION` and its vendored Unicode files are the canonical data
source. `tools/generate-unicode.ts` derives the regexp subset through a small
build-time C adapter. It normalizes ranges to `[0, 0x110000)`, deduplicates encoded
payloads and represents composite emoji properties through their components.
The checked-in generated module is 191,394 bytes with 378 shared payloads.
Decoding allocates exact-size typed arrays and caches them per compilation.

```sh
node runtime/ecmascript/tools/generate-unicode.ts
node runtime/ecmascript/tools/generate-unicode.ts --check
```

A C compiler is needed to regenerate or verify data, not to run it on JVM.
The generator is TypeScript and uses Node's built-in APIs. There is no Python
tooling or second Unicode revision to maintain. MIT and Unicode notices are in
`third_party/`.

Intl's small preference index comes from pinned CLDR 48.2 supplementalData.xml,
with its source/license hashes in `providers/icu/artifacts.json`. It records
explicit calendar/week availability and ordered hour-cycle lists, including
language-region overrides. It does not copy calendar names, weekday values,
time-zone data or general Unicode properties. Four immutable hour lists are
shared; public results are copied. The ICU gate checks generation drift.

```sh
node runtime/ecmascript/tools/generate-locale-preferences.ts
node runtime/ecmascript/tools/generate-locale-preferences.ts --check
```

The generated TS data and C header are two representations of one pinned source.
A native program using both the existing C String case-conversion code and this
regexp implementation can contain overlapping Unicode data. This change does
not claim that one binary copy exists. Removing that overlap requires migrating
String case conversion to shared Unicode primitives or a backend data ABI; that
must be coordinated with the compiler/runtime lane.

## Validation

Test262 supplies the grammar and builtin conformance tests. The host adapter in
`tooling/conformance/ecmascript/test262.ts` consumes the existing metadata
protocol and the pinned checkout. It adapts regexp literals to construct this
implementation, loads it in each test's realm and runs Test262's original harness
and assertions. It also binds the six String methods to the shared algorithms.
Its verdict is `host-pass`, not compiled builtin conformance. Global `eval` is
adapted; direct-eval lexical scope and the `$262` realm host are not implemented.
Lexical/JavaScript parse negatives outside the regexp grammar are explicitly
reported as unsupported.

```sh
pnpm exec tsc -p runtime/ecmascript/tsconfig.json
node tooling/conformance/ecmascript/test262.ts
node tooling/conformance/ecmascript/test262.ts --under test/language/literals/regexp
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/match
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/replace
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/search
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/split
```

`--rows` selects a JSONL report, `--filter` selects a path substring, and
`--timeout` sets a per-unit execution limit. Counts retain failures and scheduler
exclusions. Prefix selection includes `matchAll` with `match`, `replaceAll` with
`replace`, and `RegExpStringIteratorPrototype` with `RegExp`.

The sabotage control must fail with exit code 1 and a null-result assertion:

```sh
node tooling/conformance/ecmascript/test262.ts --sabotage --filter /S15.10.2.8_A1_T2.js
```

The small emitted-code fixture tests the integration boundary: parser execution,
captures and assertions, Unicode decoding, emoji string tries and folding.
It is supplementary to Test262, not a second conformance corpus.

```sh
NTS_BACKEND=c NTS_TSGO=target/tsgo target/release/nts check tooling/conformance/ecmascript/compiled/tsconfig.json
NTS_BACKEND=jvm NTS_TSGO=target/tsgo target/release/nts check tooling/conformance/ecmascript/compiled/tsconfig.json
```

Inspect the CLI output as well as its status: `nts check` can return success
after refusing an export. No function refusal is acceptable for this fixture.
Hostile out-of-range inputs to scalar helpers can be declined and are reported
separately by the differential harness.

Validation at Test262 revision `14e8c908e54ae2e770e473bcacf536f8cb654929`:

| Slice                     | Host passes | Failures | Unsupported | Scheduler exclusions |
| ------------------------- | ----------: | -------: | ----------: | -------------------: |
| `built-ins/RegExp` prefix |       1,874 |       21 |           0 |                    1 |
| Regexp literals           |         220 |        1 |          19 |                    0 |
| String match/matchAll     |          76 |        0 |           0 |                    0 |
| String replace/replaceAll |          98 |        0 |           0 |                    2 |
| String search             |          43 |        0 |           0 |                    0 |
| String split              |         120 |        0 |           0 |                    0 |

C and JVM each agreed on all 62 reached differential cases, with no refused
exports. Their compiler binary fingerprint was `ddec06c004727691`; 17 hostile
cases were declined and the harness did not reach its entire 203-case pool.
The always-no-match sabotage failed the positive Test262 lookahead control.
Remaining host failures are described below; they are retained in the reports.

Host measurements are reproducible with
`node tooling/conformance/ecmascript/bench.ts 5000`. On this workspace, prefix
search and buffer reuse reduced the literal-search sample from about 5.7 to
0.2 microseconds per execution. Native Node was about 0.05 microseconds. Capture
repetition and lookbehind remain substantially slower than native Node. These
measurements concern hosted TS and do not establish native/JVM throughput.

## Compiler and JVM handoff

Bind standard literals and dynamic constructors to this same parser and program
representation. An invalid dynamic pattern throws `SyntaxError`; literal syntax
errors remain frontend early errors. A compiler may precompile a literal to the
same instruction/data format later. Do not introduce a second matching engine.

The generic facade uses `Reflect.apply`, dynamic species construction and
unchecked constructor casts. These conflict with the fixed-layout boundary in
`docs/conformance/typescript.md` §13. Replace the production facade with typed
operations and direct calls while retaining the parser, matcher and reusable
buffers. Bind supported default builtin paths to those operations; the compiler
must not recreate excluded metaobject behavior to accommodate the host facade.
Host validation does not establish that the public exports compile unchanged.

Builtin lowering must provide:

- Regexp instance branding through the normal class/descriptor machinery.
  Replace existing constant-false handling of `instanceof RegExp` when the
  representation lands.
- Mutable `lastIndex`, ordered coercion and global/sticky reset rules. `exec`
  does not advance an empty match; the String algorithms do when required.
- Match arrays with `index`, `input`, `groups` and optional `indices`. Named maps
  use typed dictionaries, unmatched entries are `undefined`, and named index
  entries share the same pair objects as numbered entries. Metadata and entries
  use intrinsic creation, without invoking inherited setters.
- Supported String operations, typed replacement callbacks, iterators and regexp
  errors. Direct default construction does not need dynamic species dispatch.

The host source currently does not reproduce native object descriptors,
prototype poisoning immunity or `$262` realms. Those remain visible failures,
including the `lastIndex` descriptor, inherited setters on match-array metadata,
the RegExp object tag and iterator ancestry/tag descriptor. The project's
metaobject boundary is documented in `docs/conformance/typescript.md` §13; these
host results must not be advertised as full ECMAScript engine conformance.

Run the compiler lane's ordinary Test262 runner after builtin binding. The host
adapter cannot establish that standard syntax reaches the emitted matcher.
