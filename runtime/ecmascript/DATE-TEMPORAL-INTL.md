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
ranges use ICU's public C++ APIs; plural scalar selection reuses the C result
buffers and opens C++ range support lazily. Date/pattern adapters use C++ resource
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
   Instant and all ISO plain Temporal types are integrated; non-ISO calendar
   corrections and compiled public acceptance remain open.
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
   All five ISO plain classes, their conversions, arithmetic/week fields and
   exact relative rounding now exist. Plain ISO relative Duration totals,
   comparison and rounding reuse those operations. Named-zone formatting,
   non-ISO calendars, ZonedDateTime, complete relative-field conversion and Now
   remain open.
6. **PluralRules, ListFormat and DurationFormat.** Implement each service and
   connect localization methods to shared formatters. ListFormat's typed API,
   iterable validation, locale templates, contextual Spanish/Hebrew rules and
   exact empty-element parts exist. PluralRules shares NumberFormat's digit
   algorithm and supports cardinal/ordinal rules, notation, exact inputs and
   ranges. Provider and shared assembly witnesses pass on all five backend/memory
   configurations; compiled public acceptance and DurationFormat remain open.
7. **Other Intl services.** Complete Collator, RelativeTimeFormat, DisplayNames,
   Segmenter and Locale information APIs. Collator's typed API, shared option
   resolution and C/JVM primitives exist. RelativeTimeFormat's typed API,
   number parts and pinned C/JVM primitives also exist. DisplayNames, Segmenter,
   the remaining Locale information APIs and compiled public acceptance remain
   open.
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
  Instant and all ISO plain Temporal formatting reads immutable private slots;
  plain values ignore the formatter's time zone and bypass Date's time clipping.
  Providers also expose time-zone name enumeration, canonical/default
  names; shared code parses and normalizes Intl offset identifiers, retains named
  identifier casing and excludes ICU's non-IANA compatibility zones. Other
  non-ISO Temporal inputs and primary time-zone identity correction remain open.
- **Temporal:** one ISO scanner supplies Instant and PlainTime parsing, including
  annotation syntax, offsets, leap seconds and ambiguous bare-time rejection.
  PlainTime owns one exact within-day nanosecond Number; Duration owns validated
  fields and cached normalized BigInt time. Precision and rounding helpers use
  scalar state and read each option once. PlainDate, PlainYearMonth and
  PlainMonthDay each own one epoch-day scalar; PlainDateTime adds one exact
  nanosecond-of-day scalar. Getters allocate no intermediate date/time records.
  Bounded estimates for date differences avoid searches over years/months/days.
  Calendar rounding compares exact distances to actual adjacent boundaries and
  bubbles expanded smaller units; Duration's plain ISO relative rounding shares
  that implementation. ISO relative totals use exact calendar fractions with
  one binary64 rounding. Scalar calendar/field helpers have no class dependency;
  class identity checks and Duration construction live in separate modules.
  Zoned/non-ISO relative arithmetic and complete relative-field conversion
  remain open.
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
| Temporal.Duration        |         458 |                82 |
| Temporal.PlainTime       |         477 |                16 |
| Temporal.PlainDate       |         584 |                68 |
| Temporal.PlainDateTime   |         719 |                54 |
| Temporal.PlainYearMonth  |         498 |                11 |
| Temporal.PlainMonthDay   |         192 |                 7 |
| Intl.NumberFormat        |         220 |                29 |
| Intl.DateTimeFormat      |         184 |                60 |
| Intl.Collator            |          50 |                15 |
| Intl.ListFormat          |          70 |                11 |
| Intl.RelativeTimeFormat  |          69 |                11 |
| Intl.PluralRules         |          43 |                10 |
| Intl.Locale              |         128 |                40 |
| Intl.getCanonicalLocales |          29 |                 9 |

Failures include missing supported semantics/APIs, adapter limitations and
documented metadata/realm non-goals. These counts do not establish completeness.
Earlier reflective-facade results are superseded.

The scalar ISO parser fixture agrees on **812 cases across 18 functions** on C,
LLVM, JVM, C+RC and LLVM+RC. RC differential checks use `NTS_RC=1`. Separate
public fixtures retain canonical union refusals and optional-tuple argument-count
failures; an exit status of zero is not sufficient evidence of execution.

The pinned compiled ICU fixture now passes **C, LLVM, JVM, C RC and LLVM RC**.
C RC passes ASan, UBSan and leak checks; LLVM/native provider code is also built
with sanitizer flags, and JVM runs with verification. The fixture includes DST
gaps/overlaps/transitions, exact decimals
above 2^53, astral-digit UTF-16 parts, sign-sensitive rounding, range identity and
sources, locale metadata, and collation with embedded NULs/lone surrogates.
Date-pattern and single-date formatting probes also pass, including proleptic
Gregorian dates at both time-domain boundaries, DST, astral numbering systems,
Chinese relatedYear/yearName parts and offset time-zone identifiers.
Date ranges now execute on both backends, including interval sources and
single-date identity fallback. The public PlainDate and PlainDateTime witnesses
retain canonical union/record projection refusals on C and JVM.
The list witness also passes both backends, covering empty elements, astral and
unpaired UTF-16 units, contextual Spanish/Hebrew conjunctions and Māori suffixes.
The unpaired unit is constructed with String.fromCharCode: literal transport's
separate three-U+FFFD substitution defect remains recorded in the compiler profile.
The relative-time witness passes on both backends, including negative zero,
exact-integer automatic terms, Polish automatic grouping, astral-digit field
positions and shared standard-library part records. ICU's automatic-term lookup
uses a tolerance; TS requests it only for exact integers. Numeric parts retain
their unit, and literals omit it. Provider and TS parts buffers allocate on first
parts use and reuse their capacity. Native relative formatting uses the public
C API; Java uses ICU4J directly. The public constructor/resolved-options witnesses
still retain canonical locale-union and named-record refusals. The 11 original
Test262 residuals cover array-like locale records, excluded metadata/prototypes
and the realm host facility.
This verifies provider integration; it does not replace public API acceptance.
A separate nested generic locale fixture exposes a C interface-vtable signature
mismatch under UBSan. Logs and witnesses are retained for compiler integration.

List locale data uses three construction-only public ICU formatter samples.
This lets ICU resolve regional inheritance and aliases without private resource
APIs or a duplicate CLDR table. Shared TS decodes and caches Pair/Start/Middle/End;
format assembles one exactly sized segment array and joins once, while parts
retain empty element records. Pinned CLDR 48.2 Start/Middle templates have no
outer affixes; Pair/End affixes are preserved. The pin audit examined 14,613 raw
templates and 24,462 resolved samples over all available locales/styles/types.
Ordinary formatting performs no locale lookup; Hebrew context uses a direct,
allocation-free ICU script predicate. Original ListFormat failures remain visible:
array-like locale records, excluded metadata/prototypes and the realm host facility.

PluralRules uses the same SetNumberFormatDigitOptions implementation as
NumberFormat. NumberFormat inherits the configuration slots, retaining a single
configuration object and the specified getter/conversion order. Both services
translate the slots into pinned ICU skeletons at construction. Native scalar
selection reuses a formatted-number result and returns a category code without
allocating an NTS string. Ranges cache formatter variants on first use; identity
uses complete rounded text, including signs and notation. When both possible
categories agree, no second scalar formatting or identity comparison is needed.
Category arrays are ordered and copied for each resolvedOptions result. The 10
host Test262 residuals cover metadata/prototypes, prototype tampering and the
realm host facility. The public C/JVM witnesses retain locale and mathematical
input-union refusals and an intersection-result refusal.

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
- NtsNumberFormat, NtsCollator, NtsListFormat and NtsRelativeTimeFormat implement
  their complete library instance contracts. RelativeTimeFormat's specified
  numberingSystem input supplements the pinned library via the NumberFormat
  field type. Provider field helpers project standard part fields where the
  compiler currently refuses the direct library part-array representation.
- NtsPluralRules implements the library's select contract and adds selectRange.
  Notation, rounding and exact input types derive from NumberFormat. Its honest
  resolved result corrects the pinned PluralRules library's required fraction
  fields: significant-only precision omits them. There is no erased result cast
  or copied standard declaration. NumberDigits keeps the concrete option record
  type so sharing its algorithm requires no record projection or extra allocation.
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
generic locale dispatch, Iterable method dispatch and Date Parameters tuple argument counts also need
compiler fixes. Keep canonical types and the reproducing fixtures. Do not replace
these paths with erased inputs, casts or duplicated scalar-only public APIs to
make a probe pass. Main's local handoff contains the concrete integration cases.
Separate digit-constructor probes also retain inferred optional-field and
undefined generic-argument refusals. The provider witness uses an explicitly
typed NumberFormatOptions record; it does not establish these public paths.

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

The plural provider sample measured about 220 ns on C RC and 207 ns on JVM for
scalar selection, and 833/802 ns for ranges, with matching checksums. It uses
reused Polish cardinal rules, 500,000 scalar or 100,000 range calls, and one
provider construction per timed batch. Range timing includes String(index)
conversion. JVM warms up for 50,000 calls. This is provider throughput, excluding
public mathematical conversion and resolvedOptions; it is not an allocation or
complete-service benchmark.

The list assembly sample measured roughly 152/3,052/28,631 ns on C RC and
224/2,542/21,606 ns on JVM for 3/100/1,000 elements, with equal checksums.
JVM warmed up for 10,000 calls. This includes String(index) and one pattern/data
construction per timed batch; it excludes the public Iterable conversion and
does not claim complete-service throughput. Increasing length from 100 to 1,000
scaled time by about 9.4x on C and 8.5x on JVM.

Local Linux x86-64 size evidence (2026-10-04, `-O2`, without sanitizers): the
four native C++ adapter objects contain **33,067 bytes of allocated code/data**
before final linking. The untrimmed pinned ICU4J jar is **14.5 MiB** and the native
ICU data archive is **31.6 MiB**. The list-milestone compiled ICU integration fixture is
**35.6 MiB stripped**, without section garbage collection; this is not a whole
public Intl application or the final platform packaging policy. The larger cost
is ICU code/data, rather than the adapter language. The earlier adapter baseline
before date ranges and list data queries was 28,337 bytes; the list measurement
is retained in target/ecmascript/audit/size/list-milestone-report.json.
The new plural adapter adds **8,429 bytes** of allocated object code/data under
the same flags, bringing the five C++ adapter objects to **41,496 bytes**.
This is an object-section measurement, not a linked application size or a
reachability guarantee; its inputs and hashes are retained in
target/ecmascript/audit/size/plural-milestone-report.json.

An earlier direct UTC/ISO core sample links and runs without ICU on C and JVM. Its
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
node runtime/ecmascript/tools/icu.ts --pinned-native --all-backends --sanitize
node runtime/ecmascript/tools/icu.ts --pinned-native --bench
node runtime/ecmascript/tools/icu.ts --pinned-native --android
```

After a Java provider API change, use `--regenerate-bindings` to refresh the
declarations and binding table together. Never format the generated declarations
independently: the binding table records byte offsets. The ICU tool checks drift.
