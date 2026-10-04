# Shared Date, Temporal and Intl

Date, Temporal and all ECMA-402 services are the target within NTS's typed
object model. The plan is in progress. Standard builtin binding and complete
compiled public acceptance remain open, alongside the APIs listed below.
The supported representation boundary is
[typescript.md §13](../../docs/conformance/typescript.md#13-what-this-compiler-is-not).

## Standing architecture and performance requirements

Best architecture, clean code and performance apply to every stage.

ECMAScript semantics live in shared TypeScript. Native C/C++ and Java expose pinned ICU
data and text primitives through typed adapters. They do not implement separate
JS parsing, rounding, clipping, option resolution, disambiguation or parts
algorithms. Production calls use the native C ABI or ordinary Java calls.
JNI is not used. Native locale matching and independently configured number
ranges use ICU's public C++ APIs; date/pattern adapters also use C++ resource
ownership. ICU's static native libraries already require the C++ standard
library. The generated C program sees only the narrow C ABI.

Public inputs, options and results use the pinned TypeScript libraries directly.
Use a derived contract only to express a supported subset or an actual library
typing defect. Do not rename an existing library type, duplicate its declarations,
or assert an erased value into an ABI layout. Classes check their implemented
contracts with `implements`.

Date owns mutable clipped milliseconds; Temporal values own immutable state.
Private fields and instance descriptors supply branding. No WeakMap side table,
descriptor patch, dynamic prototype setup, reflective coercion or function
metadata repair belongs in these implementations. The user requires discussion
before introducing WeakMap. Intrinsic graphs, descriptors, realms, species and
coercion hooks are object-model non-goals, not compiler prerequisites.

Gregorian arithmetic and ISO parsing do not depend on host Date or ICU.
UTC/ISO-only binaries must not acquire ICU. Host clocks, default locale and
default zone belong to an injected environment. Formatters and locale matchers
are created outside hot loops. Handles follow managed boxed lifetime on C and
ordinary GC on JVM. Typed scratch buffers grow when required and are reused;
parts arrays have their exact output size. Array push is appropriate for builders
whose output size is unknown; its presence alone is not a performance defect.

The initial production providers use bundled ICU4J on JVM/Android and matching
ICU4C on native platforms. The optional Java provider targets Java 11; the Java-8
core runtime remains independent. Android device ICU requires separate API/data
and artifact-size evidence before becoming another provider.

## Accepted completion plan

1. **Compiler integration.** Support canonical library unions, record projection,
   nested generic dispatch, standard builtin binding, actual supplied argument
   counts and mutable Date representation. The compiler lane owns these changes.
2. **Shared foundations.** Complete locale validation, aliases, extension
   negotiation/matching, Locale, supportedValuesOf, clocks/default locale/zone,
   calendar metadata and conversion. Locale metadata is implemented through ICU.
   supportedValuesOf, primary time-zone identities, calendar conversion and
   runtime host binding remain open.
3. **NumberFormat and DateTimeFormat.** Complete exact public inputs, bound
   formatting, resolved options, ranges, parts and Temporal date/time inputs.
   NumberFormat's shared semantics and C/JVM primitives exist; compiled public
   acceptance remains open. DateTimeFormat pattern metadata, basic matching,
   construction, single/range formatting and UTF-16 parts exist on both providers.
   Instant, PlainTime and ISO PlainDate inputs are integrated; remaining Temporal
   types, calendar corrections and compiled public acceptance remain open.
4. **Date.** Complete standard constructor/call behavior, local operations,
   setters, localization and the Temporal bridge. Core arithmetic, parsing and
   serialization exist. UTC and multi-component setters distinguish omission
   from explicit undefined. Their emitted optional-tuple witness still exposes
   a compiler argument-count defect. Standard host binding and locale methods
   remain open.
5. **Temporal.** Complete Instant, Duration, PlainDate, PlainTime, PlainDateTime,
   PlainYearMonth, PlainMonthDay, ZonedDateTime and Now, with non-ISO calendars,
   relative arithmetic, transitions and disambiguation. Instant/Duration scalar
   operations, shared ISO scanning and non-localized PlainTime operations exist.
   ISO PlainDate arithmetic/week fields/rounding and plain ISO relative Duration
   totals/comparison now exist. Named-zone formatting, non-ISO calendars, other
   date/zoned classes, complete relative rounding and Now remain open.
6. **PluralRules, ListFormat and DurationFormat.** Implement each service and
   connect localization methods to shared formatters.
7. **Other Intl services.** Complete Collator, RelativeTimeFormat, DisplayNames,
   Segmenter and Locale information APIs. Collator's typed API, shared option
   resolution and C/JVM primitives exist. The other services and compiled public
   acceptance remain open.
8. **Packaging and performance.** Finish reachability-controlled acquisition,
   platform/device acceptance and construction, format, parts, range, startup,
   heap and artifact-size measurements.

Independent semantic/provider work can proceed while compiler integration is
pending. No stage is complete solely because a host or provider probe passes.

NTS deliberately uses fixed-width 128-bit BigInt. It covers Temporal's timestamp
domain; arbitrary-precision BigInt is outside this plan. NumberFormat decimal
strings preserve all digits across the provider boundary without entering this
BigInt domain.

## Implemented shared paths

- **NumberFormat:** locale negotiation; style/unit/currency/digit options in
  specified read order; exact decimal, BigInt and string dispatch; stable lazy
  bound format; resolved options; formatting, ranges and parts. ICU supplies
  currency precision, text and UTF-16 spans. Sign-sensitive halfCeil/halfFloor
  configurations are selected in shared code. Range handles are created lazily
  and reused; equal-range approximation and source attribution are preserved.
- **Locale:** structural language-tag validation, CLDR aliases, likely subtags,
  overrides, maximize/minimize and data getters. ICU supplies calendars,
  collations, preferred hour cycle, numbering system, zone lists, script
  direction and weekday metadata. Shared code controls JS lists and result
  objects. Primary time-zone naming and unavailable-region override fallback
  still require finishing.
- **Collator:** ordered option conversion and extension negotiation; stable lazy
  bound comparison; resolved options. C borrows Latin-1/UTF-16 inputs through ICU
  iterators/direct spans; JVM compares its native strings. No provider input
  copy or TS options/result allocation is introduced by the comparison callback.
- **DateTimeFormat:** ordered options, calendar aliases/deprecation fallback,
  locale and hour-cycle negotiation, styles, resolved options and lazy bound
  format. Shared quote-aware ICU pattern metadata,
  skeleton construction, specified basic format matching and UTF-16 parts
  partitioning. C/JVM retain their selected-pattern formatter and buffers.
  Gregorian formatting uses a cutover below ECMAScript's entire time domain.
  Parts scratch is created lazily and reused; output arrays have their exact
  size. Interval formatters/calendars are created lazily; identity fallback keeps
  the selected single-date pattern, and shared code partitions endpoint sources.
  Instant, PlainTime and ISO PlainDate formatting reads immutable private slots;
  plain values ignore the formatter's time zone and bypass Date's time clipping.
  Providers also expose time-zone name enumeration, canonical/default
  names; shared code parses and normalizes Intl offset identifiers, retains named
  identifier casing and excludes ICU's non-IANA compatibility zones. Other
  Temporal inputs and primary time-zone identity correction remain open.
- **Temporal:** one ISO scanner supplies Instant and PlainTime parsing, including
  annotation syntax, offsets, leap seconds and ambiguous bare-time rejection.
  PlainTime owns one exact within-day nanosecond Number; Duration owns validated
  fields and cached normalized BigInt time. Precision and rounding helpers use
  scalar state and read each option once. Calendar-relative operations remain
  unfinished. PlainDate's ISO stage owns one epoch-day scalar and uses bounded
  estimates for date differences, avoiding searches over years/months/days.
  ISO relative Duration totals use exact calendar fractions with one binary64
  rounding; zoned/non-ISO relative arithmetic remains open.
- **Date:** mutable private state and scalar UTC/local operations. Static UTC
  and multi-component setters use standard Parameters tuples to preserve the
  supplied argument count. The standard compiled boundary remains pending.

## Pins and verification

The specification, Test262 and data revisions are in
[versions.json](providers/icu/versions.json). The Maven artifact is hash-pinned in
[dependencies.tsv](providers/icu/dependencies.tsv); native source and license
hashes are in [artifacts.json](providers/icu/artifacts.json). Cached downloads are
verified. ICU 78.3 contains Unicode 17, CLDR 48.2 and TZDB 2026a; its CLDR runtime
API reports 48.0. Runtime version checks use that reported value; exact artifact
hashes identify the maintenance data. The redistribution notice is preserved.

Original Test262 supplies the semantic corpus. The host adapter loads the actual
shared classes in each test realm and retains all failures. Its Intl bridge calls
the same pinned Java provider as compiled TS and preserves UTF-16 code units.
It is supplementary POSIX host tooling, not a production transport or a native
formatter fallback. Reports say host-pass; they never claim compiled standard
builtin conformance.

Current host results against Test262
`14e8c908e54ae2e770e473bcacf536f8cb654929` (2026-10-04):

| Slice                    | Host passes | Retained failures |
| ------------------------ | ----------: | ----------------: |
| Date                     |         390 |               204 |
| Temporal.Instant         |         415 |                50 |
| Temporal.Duration        |         417 |               123 |
| Temporal.PlainTime       |         474 |                19 |
| Temporal.PlainDate       |         526 |               126 |
| Intl.NumberFormat        |         220 |                29 |
| Intl.DateTimeFormat      |         167 |                77 |
| Intl.Collator            |          50 |                15 |
| Intl.Locale              |         128 |                40 |
| Intl.getCanonicalLocales |          29 |                 9 |

Failures include missing supported semantics/APIs, adapter limitations and
documented metadata/realm non-goals. These counts do not establish completeness.
Earlier reflective-facade results are superseded.

The scalar ISO parser fixture agrees on **812 cases across 18 functions** on C,
LLVM, JVM, C+RC and LLVM+RC. RC differential checks use `NTS_RC=1`. Separate
public fixtures retain canonical union refusals and optional-tuple argument-count
failures; an exit status of zero is not sufficient evidence of execution.

The pinned compiled ICU fixture passes **C RC with ASan, UBSan and leak checks**
and **JVM verification**, including DST gaps/overlaps/transitions, exact decimals
above 2^53, astral-digit UTF-16 parts, sign-sensitive rounding, range identity and
sources, locale metadata, and collation with embedded NULs/lone surrogates.
Date-pattern and single-date formatting probes also pass, including proleptic
Gregorian dates at both time-domain boundaries, DST, astral numbering systems,
Chinese relatedYear/yearName parts and offset time-zone identifiers.
Date ranges now execute on both backends, including interval sources and
single-date identity fallback. The public PlainDate witness retains canonical
union/record projection refusals on C and JVM.
This verifies provider integration; it does not replace public API acceptance.
A separate nested generic locale fixture exposes a C interface-vtable signature
mismatch under UBSan. Logs and witnesses are retained for compiler integration.

The earlier loop-condition compiler defect
[a-postfix-increment-in-a-loop-condition-is-not-carried](../../tooling/conformance/outcomes/a-postfix-increment-in-a-loop-condition-is-not-carried/src/main.ts)
was recorded at `9ef297662` and fixed by the compiler lane. The padding algorithm
uses bounded multiplication; the runtime loop-header audit found no remaining
increment/decrement expressions in loop conditions.

## Type audit and remaining integration boundary

The libraries already include `lib.esnext.temporal.d.ts`; no extra package,
copied ambient declarations or renaming aliases are needed.

- Inputs use Temporal.DurationLike, InstantLike, PlainTimeLike and the canonical
  readonly options directly. Units and precisions derive from their libraries.
- DateFields, DurationLike, InstantLike, DateFormatter and FormatPart copies are
  removed. DateComponent expresses Date's actual subset of Temporal units.
- NtsDate's supported contract corrects Date.toJSON's nullable result and omits
  pending localization/bridge members. Instant, Duration and PlainTime omit
  unfinished localization/zoned members. The type-only
  [WithResult](src/contract.ts) binds implemented object results to shared classes
  while retaining both library overloads; it emits no allocation or code.
- NtsNumberFormat and NtsCollator implement their complete library instance
  contracts. Provider field helpers project standard part fields where the
  compiler currently refuses the direct library part-array representation.
- NtsLocale corrects the library's hourCycle/caseFirst getter narrowing: a valid
  Unicode extension may have an unknown or empty value. variants and
  firstDayOfWeek supplement members missing from the pinned LocaleOptions.
- DateTimeFormatPart derives the standard value field and corrects the pinned
  library's missing relatedYear/yearName type names. It is a record interface,
  rather than an asserted or erased provider layout.
- TimeHost, TimeZoneRules, locale/data capabilities, native primitives, nominal
  foreign handles and physical scanners/buffers are internal contracts with no
  standard-library equivalent. Provider imports use pure capability modules.
- RegExp's unmatched capture/indices types correct inaccurate library array
  elements. Its earlier reflective facade still needs a separate typed-boundary
  rewrite; Date/Temporal/Intl must not reproduce that architecture.

Public C/JVM compilation still refuses canonical Temporal/Intl unions. Nested
generic locale dispatch and Date Parameters tuple argument counts also need
compiler fixes. Keep canonical types and the reproducing fixtures. Do not replace
these paths with erased inputs, casts or duplicated scalar-only public APIs to
make a probe pass. Main's local handoff contains the concrete integration cases.

## Acceptance still required

Run original Test262 through actual compiled standard bindings on C, LLVM, JVM,
C+RC and LLVM+RC. Retain refusals, timeouts, failures and unvisited cases. Complete
binding-drift checks, relevant lane gates, native sanitizers/leaks and JVM
verification before accepting a change.

Validate Linux, Windows, macOS/iOS, JVM and Android; Android API 29, 30, 33 and
current, plus desktop Java 11 and current LTS. Existing Android evidence covers
API-29 dex/resource packaging, not device execution. The APK packager preserves
dependency resources, dex files and licenses and rejects conflicting resources.

The reused-number-formatter sample measured approximately 592 ns on C RC and
625 ns on JVM for 50,000 calls, with matching checksums. This is a provider
microbenchmark, not a whole-public-API throughput, allocation or startup claim.
Broader measurements and reachability-controlled packaging remain open.

Local Linux x86-64 size evidence (2026-10-04, `-O2`, without sanitizers): the
four native C++ adapter objects contain **28,337 bytes of allocated code/data**
before final linking. The untrimmed pinned ICU4J jar is **14.5 MiB** and the native
ICU data archive is **31.6 MiB**. The current compiled ICU integration fixture is
**35.5 MiB stripped**, without section garbage collection; this is not a whole
public Intl application or the final platform packaging policy. The larger cost
is ICU code/data, rather than the adapter language.

A direct UTC/ISO core sample links and runs without ICU on C and JVM. Its
stripped C executable is 51,640 bytes with section garbage collection and links
only the normal C/math libraries. JVM runs with emitted classes and the 145,457
byte core runtime jar alone under `-Xverify:all`. These supplementary artifacts
and commands are retained under `target/ecmascript/audit/size`; provider
acquisition through the final standard builtin bindings still needs acceptance.
Do not silently remove locale/calendar data to shrink a full-coverage provider.
Any reduced data profile must specify its supported coverage.

```sh
pnpm exec tsc -p runtime/ecmascript/tsconfig.json
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/Temporal/PlainTime
node tooling/conformance/ecmascript/test262.ts --under test/intl402/NumberFormat
node tooling/conformance/ecmascript/test262.ts --under test/intl402/Collator
NTS_BACKEND=c NTS_RC=1 NTS_TSGO=target/tsgo target/debug/nts check tooling/conformance/ecmascript/date-compiled/tsconfig.iso-parser.json
node runtime/ecmascript/tools/icu.ts --pinned-native --sanitize
node runtime/ecmascript/tools/icu.ts --pinned-native --bench
node runtime/ecmascript/tools/icu.ts --pinned-native --android
```

After a Java provider API change, use `--regenerate-bindings` to refresh the
declarations and binding table together. Never format the generated declarations
independently: the binding table records byte offsets. The ICU tool checks drift.
