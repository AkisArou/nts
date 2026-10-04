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
or assert an erased value into an ABI layout. Keep class declarations plain:
do not add `implements` checks or mapped adapters to rebind standard return
types. Method parameters and results, and injected provider boundaries, carry
the useful type checks directly.

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
   calendar metadata and conversion. Locale metadata uses public ICU primitives
   and the minimal pinned preference availability/hour-order index.
   supportedValuesOf and primary time-zone identities now share cached TS
   semantics and pinned public ICU data primitives. Calendar data now has
   public C/JVM cursors, exact shared arithmetic for eleven non-ISO calendars,
   and validated month-boundary snapshots with a two-year cache. All calendar
   value classes now use these contexts. Chinese/Korean year data is generated
   from licensed, pinned tables. Actual compiled strategy/value acceptance and
   runtime host binding remain open.
3. **NumberFormat and DateTimeFormat.** Complete exact public inputs, bound
   formatting, resolved options, ranges, parts and Temporal date/time inputs.
   NumberFormat's shared semantics and C/JVM primitives exist; compiled public
   acceptance remains open. DateTimeFormat pattern metadata, basic matching,
   construction, single/range formatting and UTF-16 parts exist on both providers.
   Instant and all plain Temporal types are integrated, including calendar
   identity validation. Shared prepared calendar fields for formatting, range
   pattern selection and compiled public acceptance remain open.
4. **Date.** Complete standard constructor/call behavior, local operations,
   setters, localization and the Temporal bridge. Core arithmetic, parsing and
   serialization exist. UTC and multi-component setters distinguish omission
   from explicit undefined. Their emitted optional-tuple witness still exposes
   a compiler argument-count defect. The three locale methods now use shared
   Intl. Original-value snapshots, intrinsic slot reads/writes and the optional
   Temporal bridge now pass the host environment witness. Complete shipping
   standard binding and local environment wiring remain open.
5. **Temporal.** Complete Instant, Duration, PlainDate, PlainTime, PlainDateTime,
   PlainYearMonth, PlainMonthDay, ZonedDateTime and Now, with non-ISO calendars,
   relative arithmetic, transitions and disambiguation. Instant/Duration scalar
   operations, shared ISO scanning and non-localized PlainTime operations exist.
   All five ISO plain classes, their conversions, arithmetic/week fields and
   exact relative rounding now exist. Plain ISO relative Duration totals,
   comparison and rounding reuse those operations. Instant named-zone formatting
   and the shared local-time/transition foundation now exist. The ISO
   ZonedDateTime value class has parsing, getters, field replacement,
   arithmetic, variable-day rounding, differences, transitions and plain-type
   conversions. Duration's ISO plain/zoned relative conversion, comparison,
   rounding and totals now reuse these kernels. Temporal.Now uses injected
   nanosecond clock/default-zone capabilities and direct result construction.
   All eight value classes now localize through shared Intl. Non-ISO plain and
   zoned arithmetic, differences, conversions and Duration-relative operations
   retain their resolved calendar context. Shipping clock/locale bindings,
   formatting data consistency and compiled public acceptance remain open.
6. **PluralRules, ListFormat and DurationFormat.** Implement each service and
   connect localization methods to shared formatters. ListFormat's typed API,
   iterable validation, locale templates, contextual Spanish/Hebrew rules and
   exact empty-element parts exist. PluralRules shares NumberFormat's digit
   algorithm and supports cardinal/ordinal rules, notation, exact inputs and
   ranges. Provider and shared assembly witnesses pass on all five backend/memory
   configurations. DurationFormat now has typed options, exact fractional
   formatting, digital patterns, parts and C/JVM data providers; Duration's
   localization uses this same formatter. Compiled public acceptance remains open. Its native
   callback sanitizer failure and JVM part-record defect remain acceptance gaps.
7. **Other Intl services.** Complete Collator, RelativeTimeFormat, DisplayNames,
   Segmenter and Locale information APIs. Collator's typed API, shared option
   resolution and C/JVM primitives exist. RelativeTimeFormat's typed API,
   number parts and pinned C/JVM primitives also exist. DisplayNames now has a
   typed implementation, shared validation/fallback and public C/JVM data
   primitives. Segmenter's shared options, independent lazy text cursors,
   containment and iteration now exist through public C/JVM primitives.
   Locale's calendar/hour/week fallback and country zone identity now share
   cached algorithms. Common iterator helpers and compiled public acceptance
   remain open.
8. **Packaging and performance.** Finish reachability-controlled acquisition,
   platform/device acceptance and construction, format, parts, range, startup,
   heap and artifact-size measurements.

Independent semantic/provider work can proceed while compiler integration is
pending. No stage is complete solely because a host or provider probe passes.

NTS currently uses fixed-width 128-bit BigInt. This is a real general ECMAScript
gap, and the user has requested arbitrary precision in MainCodex's compiler/runtime
plan, with a small-value fast path. Temporal's timestamp and validated duration
formatting domains fit the current representation. NumberFormat decimal
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
  collations, numbering system, country zone lists, script direction and week
  values. Shared code resolves override/base/world fallback independently for
  calendars, hour cycles and week data, applies explicit keywords, filters
  deprecated calendar preferences and produces fresh JS results. The small
  generated CLDR index supplies explicit preference availability and all ordered
  hour cycles, including language-region data absent from public ICU queries.
  Calendar/hour/week caches belong to one immutable Locale and never escape.
  Country zone lists retain ICU's location filter and use its public IANA
  identity API, preserving country-specific zones while updating legacy names.
- **supportedValuesOf:** canonical library key types, canonical calendars and
  collations, currencies, decimal numbering systems, IANA primary time zones
  and the single sanctioned-unit table shared with NumberFormat validation.
  The environment caches ordered unique sets and returns independent arrays.
  ICU's public IANA identity lookup preserves country-specific primary zones
  and updated names; UTC normalization and non-IANA filtering remain shared TS.
  Bulk enumeration crosses the provider boundary once per data category.
- **DisplayNames:** the full library instance contract, ordered options,
  all six name types, code validation/canonicalization, dialect selection,
  missing-name fallback and resolved options. Public ICU data supplies names;
  the native provider uses C APIs and the JVM provider uses ordinary ICU4J calls.
  The twelve date/time field names are cached by ordinal. Other names have a
  lazy eight-entry cache, including missing results; conversion and validation
  still run on each call. Arbitrary language inputs cannot grow the cache.
- **Segmenter:** canonical library options, resolved results and segment records;
  grapheme, word and sentence boundaries; independent lazy iterators and
  containment. Empty text and invalid containment queries open no text cursor.
  Each iterator/search cursor clones configured ICU rules and retains its input.
  Iteration keeps scalar boundaries; it creates the fresh result records the API
  requires, without building a complete boundary array. Word results alone own
  isWordLike. Containment seeks the following boundary once and walks adjacent
  boundaries, preserving surrogate pairs and ICU's dictionary cache. Native C
  uses the public UText provider API: UTF-16 is borrowed, and Latin-1 is decoded
  in bounded 512-unit chunks. JVM passes native strings to ICU4J directly.
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
  Instant and all plain Temporal formatting reads immutable private slots;
  plain values ignore the formatter's time zone and bypass Date's time clipping.
  Providers also expose time-zone name enumeration, canonical/default
  names; shared code parses and normalizes Intl offset identifiers, retains named
  identifier casing and excludes ICU's non-IANA compatibility zones. Full dates
  allow ISO inputs or matching calendars; partial dates require matching
  calendars. Numeric range inputs are converted once in argument order before
  type matching or clipping. Primary identity has a separate cached query;
  formatting retains the specified named identifier. ICU's independent calendar
  fields still disagree with corrected Chinese data and era rules; the shared
  prepared-field formatting path remains required.
- **Temporal:** one ISO scanner supplies Instant and PlainTime parsing, including
  annotation syntax, offsets, leap seconds and ambiguous bare-time rejection.
  PlainTime owns one exact within-day nanosecond Number; Duration owns validated
  fields and cached normalized BigInt time. Precision and rounding helpers use
  scalar state and read each option once. PlainDate, PlainYearMonth and
  PlainMonthDay each own one epoch-day scalar; PlainDateTime adds one exact
  nanosecond-of-day scalar. Non-ISO values additionally retain their resolved
  calendar context; ISO values require no context. Getters allocate no
  intermediate date/time records.
  Bounded estimates for date differences avoid searches over years/months/days.
  Calendar rounding compares exact distances to actual adjacent boundaries and
  bubbles expanded smaller units; Duration's plain relative rounding shares
  that implementation. Relative totals use exact calendar fractions with
  one binary64 rounding. Scalar calendar/field helpers have no class dependency;
  class identity checks and Duration construction live in separate modules.
  Zoned relative arithmetic reuses those kernels and keeps date days separate
  from elapsed hours. Field preparation reads each property once in the specified
  order and constructs only the resulting plain or zoned value. YearMonth keeps
  the first calendar day of its reference month. MonthDay resolves deterministic
  reference dates, including the specified Chinese/Korean leap-month table.
- **Temporal time zones:** shared exact local-time resolution, offset matching,
  gap/fold disambiguation, missing-midnight start of day and exclusive transition
  queries. Extended local milliseconds stay exact in Number; sub-millisecond
  fragments stay separate, and complete nanosecond timestamps never enter
  Number. Instant formatting supports named zones, fixed offsets and historic
  sub-minute offsets, with the specified minute-rounded output. One immutable
  named-zone environment retains eight handles. Each resolved handle retains both its requested named identifier and its IANA
  primary identity. Each handle lazily caches two
  adjacent UTC offset periods, including their local gap/fold windows. Nearby
  timestamps reuse public rule data; arbitrary timestamps cannot grow the cache.
  The value class retains the resolved zone snapshot and derives local day,
  time and offset scalars once. Its getters do not query the provider or
  allocate records. Zoned differences keep calendar days separate from elapsed
  hours, compare exact boundary distances and use bounded date corrections.
  Its calendar context survives arithmetic, rounding, zone changes, transitions
  and plain conversions. Compiled public acceptance remains open. Shared
  localization now uses the same Intl formatter as other Temporal values.
- **Date:** mutable private state and scalar UTC/local operations. Static UTC
  and multi-component setters use standard Parameters tuples to preserve the
  supplied argument count. The standard compiled boundary remains pending.
- **DurationFormat:** typed public methods, ordered options,
  textual/digital/mixed styles, negative durations, exact fractional aggregation,
  truncation, resolved options and standard-library parts. Temporal's Intl
  amendment supplies the duration-string input; conversion and validation reuse
  Temporal.Duration, and branded values read private slots. Number formatter
  variants, list templates and parts scratch are lazy and reused. Single-group
  formatting avoids list assembly arrays and template loading.

## Temporal time-zone foundation checkpoint, 2026-10-04

Original Instant Test262 initially improved from 415/465 to 423/465. With the
ZonedDateTime class, private-slot conversions and ordered round-option fixes,
that checkpoint reached 459/465. Standard constructor conversion, localization
and excluded intrinsic metadata remain visible in those failures. The
supplementary host provider uses the same pinned ICU4J primitives; production
uses direct C/Java calls.

The ISO ZonedDateTime checkpoint passed 893/901 original host tests,
including every `with`, `until` and `since` test. The eight retained failures
concern localization and excluded intrinsic metadata. PlainDate and
PlainDateTime now convert through the same resolved zone capability and
local-time kernel. Month-code and offset preparation require string primitives;
offset syntax is validated before reading subsequent fields. The exact offset
matcher preserves its distinct lower-range restriction. No provider context or
transient prepared-fields record is stored in individual values.

The user requested plain class declarations. All `implements` clauses, the
mapped return-rebinding helper and the unused DateTimeFormat wrapper contract
are removed. Strict shared/C/JVM TypeScript checks pass. All 901 ZonedDateTime
verdicts and reasons were unchanged by that declaration cleanup. The current
compiled provider gate stops before execution: NTS does not discover structural
interface implementors without an explicit clause. C/JVM minimal implicit and
explicit controls, plus the actual value-class witness, retain the diagnostics
for the compiler lane. This is a compiler dependency; no casts or replacement
ambient contracts hide it. The earlier compiled cache/performance receipts
below precede this cleanup and are not current-source compiled acceptance.

The relative Duration checkpoint passed 536/540 original host cases, including all 50 comparison,
126 rounding and 78 total cases. Relative conversion preserves branded zoned
slots and prepares plain/zoned bags through one ordered scalar routine. Strings
are scanned once. Zoned totals use adjacent actual boundaries, exact rational
arithmetic and one final binary64 rounding. Zero-duration calendar rounding and
totals still validate the required next boundary; plain totals preserve the
specified zero-duration early return at the range endpoints. Constrained
month/year totals shift their rounding window once when necessary. The four
retained failures concern localization and excluded metadata. These changes fix
44 original cases without regressions; all 901 ZonedDateTime verdicts remain
unchanged. Internal Duration reads use branded static helpers, with unused
instance readers removed. Current public C/JVM emission still has canonical
union, structural/generic dispatch and representation diagnostics; it is not
compiled acceptance.

Temporal.Now implements all six operations through one environment with an
injected nanosecond clock, a current canonical default-zone query and the shared
zone resolver. It retains clock precision, clamps samples to Instant's range,
resolves a requested zone before sampling and samples once per value operation.
Plain results reuse module-level scalar factories, with no temporary Temporal
values or prepared field records. The default-zone identifier query opens no
rule handle. Its original host result is 56/66; the ten retained failures are
excluded metadata. The supplementary host clock queries java.time.Instant,
without synthesizing precision from Date.now. Shipping clock bindings remain
open; the production algorithms depend on typed injected capabilities.

The actual clock/value fixture typechecks and its host driver verifies -1ns
across all result types, five samples/three default queries, range clamping and
zone rejection before sampling. Current C/JVM emission remains unaccepted:
calling a typed BigInt-returning function through a field is refused on both
backends, alongside the existing canonical union/structural/generic blockers.
A minimal bigint callback fixture retains these diagnostics; its otherwise
identical number control executes successfully on C and JVM with verification.
Exit zero and partial artifacts are not acceptance. That complete original
Temporal host checkpoint passed 4,551/4,603, with no previously passing cases regressed;
Now also unblocks a PlainDateTime return-type case and a global key-presence
case. Localization and non-ISO semantics remain incomplete despite weak tests
that only require a string result. DateTimeFormat was 191/244 at that checkpoint.

The calendar foundation supplies one shared arithmetic implementation for
Gregorian variants, Coptic/Ethiopic, Indian, tabular Hijri and Hebrew calendars.
Reusable cursors retain year boundaries and allocate no per-date object during
load/conversion. Hebrew uses Euclidean arithmetic through negative years;
ICU4J's Hebrew cache hangs in that range, as confirmed by the retained stack at
target/ecmascript/audit/calendar-data/jvm-live-stack.log. The raw C/JVM Hebrew
primitives decline dates before year 1 before entering that cache; shared
arithmetic handles the range. Native sanitizer and verified JVM witnesses cover
negative-year rejection and the valid epoch. Provider reverse conversion remains
an estimate; CalendarYear validates complete topology before caching it.

All five calendar-bearing Temporal classes retain resolved contexts for fields,
eras, field replacement, arithmetic, differences, rounding and annotations.
Conversions use intrinsic contexts, including when subclasses override public
calendar getters. ZonedDateTime retains its context across zone changes and
transition results. Duration comparison, rounding and totals use the relative
plain/zoned value's context. ISO values keep their direct scalar path without a
calendar context or provider allocation. YearMonth reference dates identify the
first day of the actual calendar month. MonthDay uses the specified deterministic
reference search and Chinese/Korean reference-year table. ISO month-day strings
validate their parsed date but discard its year before checking the value range.

CalendarEnvironment lazily resolves one context per canonical identity. Values
retain contexts, which do not reference the environment. Large month additions
and differences use exact serial coordinates; small additions use two cached
years without initializing the lunisolar month index. Year addition preserves
month codes before counting actual months. Difference comparisons retain the
requested day until the overshoot decision, then apply overflow. The renamed
date-time-duration, relative-calendar and zoned-arithmetic kernels express their
calendar support directly and keep the scalar ISO path.

Pinned ICU4J 78.3 has independently reproduced Chinese defects in the 1987
leap-month code and 2027/2030 New Year boundaries. Chinese/Korean modern years
now use generated ICU4X data at fe2b931521a2c3e90846908faeb4fd8ee22efecb under
Unicode-3.0. This imports data only, with no ICU4X engine or Rust dependency.
The TS generator verifies source/license hashes, month counts, packed fields,
contiguous boundaries and the 1899 public-ICU boundary row. Its --check compares
the generated file exactly. Qing rows are shared, with separate modern China
and Korea rows and next-year sentinels: 1,372 packed payload bytes in total.
That is data size, not a linked application measurement.

Umm al-Qura selects tabular civil arithmetic outside years 1300–1600. Chinese
and Korean calendars use continuous, bounded 19-year approximations outside
their modern data ranges, aligned with Gregorian years to avoid large-range
drift. Supplementary checks pass 1,014 cursor, topology and month-coordinate
samples per strategy, including range endpoints and joins. Actual compiled
full-range strategy/value acceptance remains required.

All 2,029 original Intl Temporal cases pass in the completed host rerun
intl-temporal-calendar-regression-test262.jsonl. Scoped results include 976/976
PlainDate/PlainDateTime, 327/327 YearMonth, 90/90 MonthDay, 583/583 ZonedDateTime
and 21/21 Duration. This exercises the candidate classes and original test
source, with environmental capabilities supplied in each test realm. It remains
supplementary host evidence, not compiled standard-binding acceptance.
The full builtin Temporal rerun passes 4,567/4,603, with every verdict and failure
reason unchanged from the baseline. Receipts are temporal-calendar-regression-
test262.* and calendar-data/calendar-regression-comparison.json. The two ISO
MonthDay string regressions discovered during integration were fixed before
this completed rerun. Strict runtime and fixture typechecking also passes.

The actual data witness executes on C, C/RC, LLVM, LLVM/RC and verified JVM.
Each configuration passes the three corrected Chinese goldens and 128,635
Chinese/Korean table round trips, in addition to 21 raw-provider goldens,
825,000 modern raw round trips and 605,000 modern arithmetic/provider field
comparisons across 15 calendars. Native runs check ASan/UBSan; leak checking
applies to RC because NoGC retains its bump-allocated heap. The raw-provider
full-range gate deliberately remains red: Chinese/Dangi first disagree at day
-99,400,000, and Umm al-Qura requires its shared tabular fallback. Per-backend
result.log files retain these failures. The combined receipt is
target/ecmascript/audit/calendar-data/pinned-tables-all-backends.log. This is
scoped data/ABI acceptance, not complete calendar-range or public acceptance.

Actual calendar-topology and value/context fixtures typecheck but shipping C
and JVM emission still refuses implicit CalendarPrimitive implementation bodies,
alongside canonical public Temporal unions and structural/generic dispatch.
Worker B owns that compiler boundary. No implements clause or erased adapter
bypasses it. Exit zero plus partial artifacts is not acceptance. Renewed logs
are topology-tables-{c,jvm}.log and values-{c,jvm}.log in the calendar-data audit
directory. The host value fixture verifies Chinese conversions, Hebrew leap
MonthDay, a 383-day relative year and zoned calendar-month differences.

Shared localization now connects Instant, Duration, all five plain classes,
ZonedDateTime and Date's three locale methods to the existing Intl algorithms.
An environment owns the formatter capabilities; values pass their immutable
scalar slots or a branded Duration. No temporary Temporal values, copied field
records, standard-type aliases, mapped contracts or descriptor repairs are
needed. DateTimeFormat opens its selected formatter lazily, avoiding an unused
numeric-date handle when formatting Temporal. Each locale call still prepares
options in the specified order. Zoned localization rejects a timeZone option
before converting it and derives default zone names from its own zone. Invalid
Dates return their specified string before reading locales/options. Intl-absent
Temporal methods use the specified ordinary lexical formatting path.

All 56 original builtin Temporal locale tests pass with and without Intl.
The builtin run retains 35 excluded metadata failures and one standard Instant
constructor-conversion gap. All 97 Intl-specific locale cases pass within the
complete 2,029-case rerun. Date's latest environment/slot checkpoint is 543/594;
DurationFormat remains 101/110. DateTimeFormat now passes 217/244, including the
two corrected mixed-range conversion-order cases. That scoped result improves
215/244 without regressing a previously passing case; receipts are
date-time-format-calendar-regression-test262.*. Its remaining supported gaps
include Chinese field-data consistency, era labels, same-day datetime range
sharing and the pinned hanidec pattern's AM/PM spacing.
The host adapter binds Date localization to the shared formatter too, so the
original Date/Temporal comparison tests use the same algorithms and pinned data.
It does not normalize output or compare shared ICU text to Node's separate
formatting adaptations. These remain supplementary host results.

The actual C/JVM locale boundary witness covers all eight Temporal value classes
and all three Date locale methods. Both strict provider configurations typecheck;
the host driver verifies the outputs against fixed scalar cases and direct
pinned ICU partial-date patterns. Current C/JVM emission retains canonical locale
union and structural/generic dispatch refusals and therefore does not establish
execution, native performance or packaging acceptance. Receipts are under
target/ecmascript/audit/time-locale; original rows and their scoped comparison
are under target/ecmascript/icu-check/temporal-localization-*. Shipping standard
bindings and non-ISO semantics remain required.

The full Intl Temporal checkpoint ran all 2,029 original cases and passed 254.
It exposed two additional ISO time-zone defects. Shared transition search now
skips ICU rule/abbreviation changes whose total UTC offset is unchanged, while
checking exclusive progress and the Instant range on every provider result.
Day rounding caps progress just before the next first midnight when a backward
shift repeats part of today's date after tomorrow has already started. This is
the [accepted issue #3312 resolution](https://github.com/tc39/proposal-temporal/issues/3312#issuecomment-4567138597)
covered by the pinned Test262 case; the proposal's older spec snapshot still
contains the replaced assertion. The scoped Intl ZonedDateTime rerun passes
121/583, fixing both cases without regressions; all 901 builtin ZonedDateTime
verdicts and reasons remain unchanged. Combining those scoped results with the
full Intl checkpoint gives 256/2,029; this is a combined scope result rather
than another full run. Non-ISO calendar construction, conversion and field
validation still account for its retained failures. Original rows and reasons
remain in temporal-localization-all-intl-test262.jsonl and
zoned-intl-edge-test262.jsonl under target/ecmascript/icu-check. This historical
partial result is superseded by the complete 2,029/2,029 calendar rerun above.

DateTimeFormat's next semantic step is a shared calendar-field and range-pattern
path. A public prepared-Calendar probe preserves corrected fields for single
dates on ICU4C and ICU4J, but ICU4C's interval formatter clones those fields back
into its own calendar type. The retained probes are under
target/ecmascript/audit/date-fields; they are not production adapters or accepted
compiled public witnesses. The implementation must prepare calendar fields in
TS, select/split public interval-pattern data in shared code and reuse provider
text/span buffers for those prepared fields. Both single and range formatting
must use the same calendar source. Private ICU hooks, a duplicate native/JVM
calendar engine, shifted surrogate timestamps and localized-output scraping
are not acceptable shortcuts. Pattern selection and formatter construction
belong outside hot loops; range scratch and immutable year caches stay bounded.

The compiled fixture compares cached and raw ICU offsets across all 446 primary
zones and every one of 42,806 transitions from 1800 through 2099, including
local window edges, both interpretations, cache eviction and the Temporal range
endpoints. All five configurations pass 1,165,128 comparisons each, with native
ASan/UBSan and JVM verification. An additional host differential includes
nonsequential random timestamps: 1,232,028 comparisons, all equal. Separate
nanosecond golden cases cover New York folds/gaps, Lord Howe half-hour changes,
Apia's skipped date, Havana midnight changes, Monrovia historic seconds, strict
transition queries one nanosecond before/after, offset matching and endpoint
formatting. ISO zoned addition distinguishes calendar dates from elapsed
24-hour periods, handles constrained month addition and skipped dates, and
retains a fold occurrence when no date units are added. Day rounding measures
actual 23-/25-hour midnight intervals; sub-day rounding prefers the original
offset. These kernels pass all five configurations. Original PlainDateTime
round tests remain 45/45. The earlier Duration rounding checkpoint was 95/126;
the relative-value work above now passes all 126 original host rounding cases.
These are provider/cache/compiled boundary witnesses; original
Test262 remains the semantic corpus.

The original public Instant formatting probes typecheck with canonical library
options on both providers. NTS still refuses canonical Instant/Duration/TimeZone
unions, option record projection and JVM structural TimeZoneRules/ResolvedTimeZone dispatch.
Generated output and exit zero do not establish public acceptance. Native RC
negative-path acceptance is separately blocked by the compiler/runtime lifetime
of a raised RangeError: raised-error-brand.ts catches a freshly thrown error,
and ASan reports use-after-free in nts_is_class on C RC and LLVM RC. JVM returns
the expected error brand. The positive time-zone gate reports
`temporalTimeZoneErrors=false`; that obligation remains open.

Resolved identity is a shared capability distinct from raw ICU rule data. Named
aliases retain their specified spelling, while equality can use IANA primary
identity without reading overridable public Temporal getters. All 598 accepted
identifiers pass the identity audit; 40 ICU compatibility names remain excluded.
Country-specific identities such as Bratislava and Prague stay distinct.
Named UTC aliases share primary UTC; a fixed +00:00 identifier remains distinct.
The constructor identifier parser also rejects date-time strings that are valid
TimeZoneLike inputs. ICU maps IANA's Factory Zone to its Etc/Unknown sentinel;
shared resolution preserves Factory and includes it in the 446 primary names.
[ECMA-402's identifier operation](https://tc39.es/ecma402/#sec-availablenamedtimezoneidentifiers)
requires the IANA Zone/Link set; the pinned
[IANA 2026a factory source](https://github.com/eggert/tz/blob/2026a/factory)
defines that distinct Zone. This is a small provider-identity correction, not a
second time-zone database. Original supportedValuesOf stays 24/25, retaining
its descriptor failure.

Three paired compiled throughput runs use 500,000 exact local resolutions per
batch, one zone/cache construction per timed batch, C -O2 without sanitizers and
JVM verification. Warm ordinary fixed timestamps measure 35–39 ns on C RC and
41–44 ns on JVM with the period cache, versus 128–135 ns and 185–197 ns without.
Fold samples measure 65–69 ns and 61–69 ns cached, versus 282–285 ns and
240–265 ns raw. Advancing timestamps within a one-second range retain the gain:
36–41 ns C / 51–56 ns JVM ordinary, and 66–75 ns C / 70–79 ns JVM folded.
JVM thread allocation measures about 160 bytes/iteration cached versus 552–560
ordinary / 840 folded raw. Advancing cases measure about 192 bytes cached
versus 580–590 / 865–872 raw. Allocation includes the benchmark's exact equality
check and BigInt expected-value conversion; it is not engine-only accounting or
an allocation-free claim. Cold period discovery adds public transition/offset
queries and is amortized once per batch here. Public parsing, construction and
result objects are outside this scalar sample.

Reports and retained artifacts are in target/ecmascript/icu-check:
temporal-zoned-factory-all-backends.log,
temporal-zone-identities-report.json,
temporal-zone-cache-all-zones-report.json,
temporal-instant-zone-identity-comparison.json and
temporal-zone-period-cache-performance-report.json. Compiler/front-end hashes
are a406f657375a9f3fba72d93cfd5cd336201a35009996e6608f283cd9bada3dc8 and
4ec6b1a5235e473fe20e6cef4972dfc867b6ea1b9fad1351a31d8557d66e7776.

The fixed-offset parsing/formatting, constrained date addition and local-rounding
witness in tsconfig.temporal-zone-utc.json links and executes on C RC and JVM
without any ICU provider or library. Its four expected strings agree; JVM
verification passes with only emitted classes and the 145,457-byte core jar.
The stripped C binary is 100,832 bytes, linked with section garbage collection
and only normal C/math libraries. The generated C contains two warnings for
comparing a specialized FixedTimeZone pointer with a TimeZoneRules-typed null;
no strict-warning compilation claim is made. This is supplementary physical
reachability evidence, excluding final standard-binding acquisition policy.
The ordinary scalar check harness reaches no string-valued export in this
fixture; acceptance uses direct compiled ABI drivers and retained outputs,
not its exit zero. Artifacts: target/ecmascript/audit/temporal-zone-utc.

## Pins and verification

The Date environment/slot follow-up passes 543/594 original cases both with
pinned ICU and in the explicit UTC environment without Intl. It fixes 149 cases
relative to the localization checkpoint and retains two new excluded descriptor
failures for the callable constructor/prototype binding. Eighty-two new passes
are natural own-method metadata checks; the result is not a claim that 149
semantic defects were fixed. All retained failures remain in the original rows.

Setters capture the original private milliseconds before argument conversion,
commit through private state, and preserve mutations made during conversion
when the original invalid value requires an early return. The Temporal bridge
and Date cloning read private slots, ignoring overridable getTime. toJSON calls
the typed valueOf/toISOString methods, including non-finite results and subclass
overrides. The host adapter supplies callable Date construction, supplied
argument counts and local-zone injection through shared arithmetic; it does
not provide shipping runtime bindings.

The typed Date state fixture typechecks and its supplementary host driver passes
the fixed subclass/private-state outputs. Its full C/JVM main remains refused
at structural TimeZoneRules dispatch. The independent bridgeSnapshot export
does execute as -1000000 on C with ASan/UBSan and JVM with -Xverify:all, without
ICU. This is narrow bridge evidence, not full Date compiled acceptance. Receipts
are under target/ecmascript/audit/date-state and the original Date comparisons
are date-environment-slots{,-no-intl}-checkpoint.json under
target/ecmascript/icu-check. Compiler/frontend pins remain unchanged.

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
| Date                     |         543 |                51 |
| Temporal.Instant         |         461 |                 4 |
| Temporal.Duration        |         538 |                 2 |
| Temporal.PlainTime       |         491 |                 2 |
| Temporal.PlainDate       |         650 |                 2 |
| Temporal.PlainDateTime   |         771 |                 2 |
| Temporal.PlainYearMonth  |         507 |                 2 |
| Temporal.PlainMonthDay   |         197 |                 2 |
| Temporal.ZonedDateTime   |         895 |                 6 |
| Temporal.Now             |          56 |                10 |
| Intl.NumberFormat        |         220 |                29 |
| Intl.DateTimeFormat      |         192 |                52 |
| Intl.Collator            |          50 |                15 |
| Intl.ListFormat          |          70 |                11 |
| Intl.RelativeTimeFormat  |          69 |                11 |
| Intl.PluralRules         |          43 |                10 |
| Intl.DurationFormat      |         101 |                 9 |
| Intl.DisplayNames        |          49 |                 8 |
| Intl.Segmenter           |          67 |                12 |
| Intl.Locale              |         128 |                40 |
| Intl.getCanonicalLocales |          29 |                 9 |
| Intl.supportedValuesOf   |          24 |                 1 |

Failures include missing supported semantics/APIs, adapter limitations and
documented metadata/realm non-goals. These counts do not establish completeness.
Earlier reflective-facade results are superseded.

The scalar ISO parser fixture agrees on **812 cases across 18 functions** on C,
LLVM, JVM, C+RC and LLVM+RC. RC differential checks use `NTS_RC=1`. Separate
public fixtures retain canonical union refusals and optional-tuple argument-count
failures; an exit status of zero is not sufficient evidence of execution.

The earlier pinned compiled ICU checkpoint passed **C, LLVM, JVM, C RC and LLVM RC**.
It precedes the plain-class cleanup; current compiled provider dispatch remains
blocked by the compiler dependencies recorded above.
This general fixture covers the services listed below; the new DurationFormat
gate is separate and is not accepted by this result.
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
The enumeration witness executes all six standard categories, verifies sorted
unique values and fresh-array isolation, and checks alias identity separately
from retained named identifiers. It covers Europe/Kyiv, Asia/Kolkata, distinct
Europe/Prague and Europe/Bratislava, Arctic/Longyearbyen, UTC and Etc/GMT+1.
The supported-values host residual is the excluded global method descriptor;
the calendar and currency name-availability tests now pass.
The native and Java raw calendar/collation/currency/numbering/IANA identity sets
match exactly. Currency enumeration uses the public CLDR map queries: native
openISOCurrencies has a separately maintained historical table and differs from
that map; Java's currency keyword query filters out non-tender codes. Neither
table is duplicated in shared TS. Currency metadata contains 308 codes, but
XAD has no display name in any available ICU locale. The provider exposes name
availability; shared enumeration retains 307 named currencies without a
hardcoded code exception. After first use, 12,000 enumeration requests made no
provider data calls. Cache arrays remain private and each returned array
can be changed independently.
Exhaustively querying all 17,576 three-letter codes produced the same 307 named
currencies on native and Java; none were missing from the metadata map. XAD was
the sole metadata-only entry.
The Locale preference witness passes all five configurations with native
sanitizers and JVM verification. It covers region override/subdivision/likely
subtag/world priority, unavailable override fallback, language-specific hour
lists, Japan's three hour cycles, deprecated calendar filtering, explicit
unknown keywords and result-array isolation. Separate country queries agree on
all 1,676 two-letter/numeric region keys: 248 have zones, with 419 total location
entries. Public IANA identities include Kyiv/Kolkata and preserve Bratislava,
Prague, Oslo and Mariehamn. Native country queries also pass ASan/UBSan/leak
checks; JVM runs with verification.
The generator reads hash-verified CLDR 48.2 supplementalData.xml and checks the
Unicode license. Its 2,022-byte payload (2,465-byte generated TS module) contains
52 calendar availability keys, 151 week availability keys, 252 region hour keys,
24 language-region hour overrides and four shared ordered hour lists. Calendar
and week values stay in ICU; no private resource APIs are used. An independent
source audit checks all 1,700 region/language lookups, including absent keys.
After initialization, 12,000 repeated preference query sets make zero provider
calls. Explicit calendar/hour keywords make no region-data calls. Public Locale
C/JVM witnesses still refuse the standard constructor union, TextInfo/WeekInfo
records and nested generic locale calls. Original Locale Test262 remains
128/168; these witnesses and host results are separate from standard binding
acceptance. Reports are locale-preferences-all-backends.log,
locale-preferences-data-report.json, locale-preferences-cache-report.json and
locale-zones-report.json under target/ecmascript/audit.
DisplayNames' host residuals cover three array-like locale inputs, excluded
metadata/prototype behavior and the realm host facility. Its public C/JVM
witnesses retain canonical locale-union and ResolvedDisplayNamesOptions record
refusals. The typed lookup/provider witness is separate from those public APIs.
An audit of 1,638 public-provider name requests over 13 locales found 1,552
identical results. The 86 differences concern contextual versus standalone
script text and provider fallback selection for short regions/root currencies.
These are implementation-defined data selections; shared code validation,
canonicalization and fallback remain common. Expected provider text is checked
explicitly, without private ICU resource access or a duplicate name table.
The Segmenter boundary witness passes all five configurations with native
sanitizers and JVM verification. It interleaves independent cursors and checks
every UTF-16 index in both directions for grapheme/word/sentence text, including
family emoji, flags, Thai/CJK dictionary words, embedded NULs, lone surrogates and
Latin-1 chunk crossings. Both providers also pass all 766 original Unicode 17
GraphemeBreakTest vectors and agree on 300 additional provider ownership/text
cases. The native audit drops original input/rules/cursor owners before using
surviving clones, and compares the custom UText provider with ICU's contiguous
UTF-16 provider under ASan/UBSan. This supplements original Test262 rather than
replacing semantic conformance. Reports are segment-unicode-report.json and
segment-walk-all-backends.log in target/ecmascript/audit.
Segmenter's 12 host residuals retain array-like locale inputs, excluded metadata,
prototype behavior and the realm facility. Its sabotage control substitutes
empty text and fails an original containment test; the unchanged control passes.
Public C/JVM witnesses still refuse canonical locale unions, optional segment
records, iterator results and ResolvedSegmenterOptions. Common iterator helpers
and intrinsic inheritance remain runtime integration work; the typed iterator
protocol is not a claim that the complete modern SegmentIterator contract exists.
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

Duration separators and hour padding come from eight construction-only public
ICU samples; there is no duplicate CLDR table or private-resource dependency.
The audit decoded 1,218 Java locale/numbering-system combinations, including
astral digits. All 911 native samples matched Java exactly and passed native
sanitizers. HMS and HM hour padding can differ in es-CL and Turkmen; the decoder
preserves that distinction. Exact subsecond aggregation uses BigInt decimal
scaling within the validated duration domain, avoiding binary64 rounding before
ICU formats the value. The nine host residuals cover array-like locale records
and excluded metadata/prototypes.

Duration compiled acceptance remains open. Its native text gate produces the
expected exact results but UBSan detects an indirect factory call whose concrete
receiver pointer type differs from the erased function slot's receiver type.
Text results agree on all five configurations without sanitizers; this does not
accept the native callback's undefined behavior.
The JVM standard-part consumer cannot read a valid literal record with omitted
optional unit. The reduced duration-part-record fixture agrees on C's one case;
JVM declines that sole case and compares nothing. These are retained compiler
defects, not passing conformance evidence. Separate public witnesses also retain
canonical locale/duration unions and resolved-record refusals. Logs are in
target/ecmascript/audit/duration-*.log and the integration handoff records the
compiler/frontend fingerprints.

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
- Date.toJSON's result includes null for invalid dates, despite the pinned
  library's string-only declaration. Temporal methods return their concrete
  shared value classes. Class declarations have no `implements` clauses or
  mapped return-type adapters; standard input/option/result types stay direct.
- NtsNumberFormat, NtsCollator, NtsListFormat and NtsRelativeTimeFormat use
  library types on their method boundaries. RelativeTimeFormat's specified
  numberingSystem input supplements the pinned library via the NumberFormat
  field type. Provider field helpers project standard part fields where the
  compiler currently refuses the direct library part-array representation.
- NtsPluralRules uses the library's selection types and adds selectRange.
  Notation, rounding and exact input types derive from NumberFormat. Its honest
  resolved result corrects the pinned PluralRules library's required fraction
  fields: significant-only precision omits them. There is no erased result cast
  or copied standard declaration. NumberDigits keeps the concrete option record
  type so sharing its algorithm requires no record projection or extra allocation.
- NtsDurationFormat uses Intl types directly. Its input is
  Temporal.DurationLike plus the actual shared Duration class, because the pinned Intl declaration omits the Temporal
  amendment's string input. Its configuration and part types derive directly
  from the libraries, without aliases, copied declarations or erased casts.
- NtsDisplayNames uses Intl types directly. Options, name types,
  fallback/dialect values and resolved results use the library declarations.
  Provider name capabilities and ordinal tables describe internal data only.
- NtsSegmenter and NtsSegments return their concrete typed segmentation and
  iterator instances. Iterator results use IteratorResult<Intl.SegmentData,
  undefined>; options and public records use Intl declarations directly. Modern
  Intl.SegmentIterator additionally inherits common IteratorObject helpers and
  disposal; those are still pending runtime integration, with no asserted cast
  or duplicated library declaration hiding the missing contract.
- supportedValuesOf's key derives directly from the library function's
  Parameters tuple. Supported-value enumeration and IANA identity capabilities
  are provider data contracts, with no copied standard declaration.
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

The supported-values sample measured about 211 ns on C RC for numbering systems
and 1,002 ns for time zones (100,000 calls, no native sanitizer instrumentation).
Three JVM allocation runs measured 64–66 ns and about 354 bytes for numbering
systems; time zones measured 316–323 ns and about 1,833 bytes. These batches warm
the runtime and include one environment/cache initialization per timed batch;
they measure shared enumeration and fresh-array copying, not standard builtin
binding or startup. The matching 200,000-call checksums were 21674272 and 13455286. The native C++ adapter section delta is 3,429 bytes, bringing the five
adapter objects to 48,373 bytes at -O2 without sanitizers. This excludes linked
ICU data, whole application size and reachability-controlled packaging.

DisplayNames' repeated three-currency lookup sample measured 45–56 ns on C RC
and 33–35 ns on JVM after the bounded cache, versus 1,606–1,640 ns and 468–647 ns
before. Date/time field lookup measured 28–35 ns on native and 34–35 ns on JVM.
Each timed 250,000-call batch includes one provider/matcher construction and
cache initialization, after 10,000 native/50,000 JVM warmup calls. Checksums
match. Thread allocation accounting over 200,000 calls measured about 1.15
bytes/currency lookup after caching versus 617 bytes before; the remaining
allocation is amortized batch initialization. Cache instrumentation verifies
conversion/validation, absent-name caching and eviction beyond eight codes.
This measures the shared typed lookup, not compiled public construction or
standard binding. Reports are display-performance-{before,after}-cache.json
and display-allocation-{before,after}-cache.json in target/ecmascript/audit.
The new native C adapter allocates 2,764 bytes of object code/data sections;
currency availability adds 347 bytes to the existing locale adapter, bringing
the five C++ objects to 48,720 bytes. No new C++ translation unit is needed.
These -O2/no-sanitizer measurements exclude ICU and application packaging;
inputs/hashes are in target/ecmascript/audit/size/display-milestone-report.json.

Segmenter's shared compiled word-boundary sample uses 336-unit Latin-1 and
504-unit wide texts. Containment reuses one cursor and queries scattered indices;
iteration clones one cursor and traverses the complete text. Walking adjacent
boundaries after one seek reduced native containment to 170–174 ns for Latin-1
and 408–412 ns for wide text, versus 212–214/600 ns before. JVM measured
222–225/428–443 ns versus 251–253/608–628 ns. Checksums match in every run.
Each timed batch includes configuration/text initialization once; C RC uses
10,000 query warmup calls and JVM 50,000, followed by 500,000 queries. Native
uses -O2 without sanitizers, and JVM verification remains enabled. These are
scalar boundary measurements, excluding the fresh public segment/result records,
substrings, constructor options and standard binding. Reports are
segment-performance-{before,after}-walk.json in target/ecmascript/audit.
JVM thread allocation accounting measured 385–406 bytes per wide containment
query after the change, versus 620–661 before. Latin-1 containment measured
about 0.013 bytes/query, including amortized initialization. Wide dictionary
queries still allocate inside ICU; these results do not claim allocation-free
segmentation. Iteration clones one cursor per text and retains its separate
ICU allocation cost. Reports are segment-allocation-{before,after}-walk.json.
The new C adapter's allocated object sections occupy 4,931 bytes; no C++ unit
or Unicode table was added. This excludes linked ICU data and application size.

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

The compiled JVM digital-duration sample uses one formatter per batch and
1,000,000 calls after a 50,000-call warmup. Three alternating before/after runs
measured about 515–532 ns/call after single-group list assembly was removed,
versus 526–545 ns before. Thread allocation accounting measured about
2,451–2,453 bytes/call versus 2,498–2,503 before, with identical checksums. Most
remaining allocation is outside the eliminated assembly array. This physical
kernel sample includes numeric field writes and exact fractional conversion;
it excludes public duration-bag conversion and does not establish whole-service
or native throughput. Receipts are in duration-performance-paired.json.

Locale's compiled calendar/hour/week query set for en-JP measured 45–46 ns on
C RC and 31–40 ns on JVM with per-locale caches, versus 2.6 µs and 3.6–5.0 µs
for equivalent uncached provider queries. Cached results still create two fresh
arrays; JVM allocation measured 104.47 bytes/query set versus 5,871–5,906 bytes
uncached. Each batch includes provider/preference initialization once, after
10,000 native/50,000 JVM cached warmups (200/1,000 uncached), and checksums match.
Cached batches run 500,000 query sets; uncached batches run 25,000. Native uses
-O2 without sanitizers and JVM verification stays enabled. This measures the
shared preference path, excluding public constructor/result-record bindings.
Reports are locale-preferences-performance-report.json in target/ecmascript/audit.
Removing the unused default-hour-cycle primitive while adding public IANA country
identity mapping reduces the five C++ adapter objects by 96 bytes, to 48,624
allocated bytes. The small generated TS index is measured separately; these
object-section figures exclude ICU libraries, linked application size and
reachability packaging. Inputs/hashes are in
target/ecmascript/audit/size/locale-preference-milestone-report.json.

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
The public duration-data query adds 3,448 bytes in the existing locale adapter,
bringing the same five-object measurement to 44,944 bytes. No new C++ translation
unit is needed. This still excludes linked ICU dependencies and final packaging;
target/ecmascript/audit/size/duration-milestone-report.json records the inputs.

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
node tooling/conformance/ecmascript/test262.ts --under test/intl402/DurationFormat
NTS_BACKEND=c NTS_RC=1 NTS_TSGO=target/tsgo target/debug/nts check tooling/conformance/ecmascript/date-compiled/tsconfig.iso-parser.json
node runtime/ecmascript/tools/icu.ts --pinned-native --all-backends --sanitize
node runtime/ecmascript/tools/icu.ts --pinned-native --bench
node runtime/ecmascript/tools/icu.ts --pinned-native --android
NTS_BIN=target/debug/nts NTS_TSGO=target/tsgo node runtime/ecmascript/tools/icu.ts --pinned-native --duration --all-backends --sanitize
NTS_BIN=target/debug/nts NTS_TSGO=target/tsgo node runtime/ecmascript/tools/icu.ts --pinned-native --calendar --all-backends --sanitize
```

The DurationFormat command is a required pending gate and currently exposes the
native callback signature defect. Its artifacts use separate native-duration
and jvm-duration directories. duration-parts and duration-public fixture configs
retain the remaining compiled boundaries; they are not covered by the text gate.

After a Java provider API change, use `--regenerate-bindings` to refresh the
declarations and binding table together. Never format the generated declarations
independently: the binding table records byte offsets. The ICU tool checks drift.
