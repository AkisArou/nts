# Shared Date, Temporal and Intl

The target is Date, Temporal and all ECMA-402 constructors within NTS's typed
object model, delivered in stages. The representation boundary is defined in
[`typescript.md` §13](../../docs/conformance/typescript.md#13-what-this-compiler-is-not).
This document tracks implementation, not a claim that the whole plan is done.
Standard builtin lowering remains a compiler integration task. Date, Instant
and Duration now use typed classes with private state and library-derived
contracts. Canonical Temporal input unions still require compiler support before
their public APIs become compiled integration APIs.

## Architecture and performance requirements

ECMAScript rules live in TypeScript. C and Java provide ICU primitives through
small typed adapters. They do not implement separate JS parsers, rounding,
clipping, coercion, disambiguation or `formatToParts` algorithms. No JSON RPC,
JNI, JRE regex, date parsing or localized-text scraping is used at this boundary.

Date holds mutable clipped integral milliseconds in a private field, with NaN
for invalid dates. Temporal holds immutable values in private readonly fields.
No side table is needed for instance state or branding: private fields and the
compiler's instance descriptors supply those properties. WeakMap is not a
prerequisite for this plan.

Public fields, units, options and input unions use the pinned TypeScript libraries
directly. Derived types express an actual subset or representation difference;
they do not rename a library type or copy its declarations. Erased `unknown` inputs are narrowed
only at boundaries that actually accept them. Type assertions do not substitute
for runtime conversion or establish an ABI representation. Property reads and
method calls are direct; constructors initialize their own fields. Production
code must not reconstruct JavaScript prototypes, descriptors, coercion hooks,
species constructors, or observable function names and lengths. These are
declared non-goals of the object model, not compiler prerequisites to queue.

Gregorian arithmetic is independent of host Date and ICU. ISO-only operations
can import that core without importing providers. Host clock and default time
zone capabilities are injected explicitly through `TimeHost`.

Formatter creation is outside formatting loops. Native handles use the existing
managed boxed-object lifecycle; JVM handles use ordinary GC. Scratch buffers
grow when needed and are reused. Parts arrays have their exact output length.
Generic provider parameters permit direct calls in compiled formatting code.
In particular, formatter state does not rely on C interface vtable casts, which
UBSan found incompatible with the emitted concrete method signatures.

The production providers use bundled ICU4J on desktop JVM and Android, and a
matching ICU4C source build for native targets. Android's device ICU is deferred
until its API coverage, data behavior and measured artifact-size benefit justify
another provider. The Java-8 core runtime remains independent; the optional ICU
provider is compiled for Java 11. Locale resources are included in full initially.

## Pins

`providers/icu/versions.json` records the specification revisions, existing
Test262 revision, ICU 78.3, Unicode 17, CLDR 48.2 and TZDB 2026a. The exact Maven
artifact is pinned in `dependencies.tsv`; the ICU4C source and redistribution
license hashes are in `artifacts.json`. These match the upstream release asset
digests. Downloads are verified before use, including cached artifacts.

ICU's runtime CLDR API reports **48.0** for this release's **48.2** maintenance
data. The runtime checks use that reported value; exact source/jar hashes identify
the maintenance release. Providers reject mismatched component versions.
The full ICU redistribution notice is in `third_party/ICU-LICENSE`.

## Implementation stages

| Stage                   | Implemented                                                                                                                                                                        | Required next                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations             | Pins; Gregorian arithmetic; exact nanosecond helpers; typed host/time zone interfaces; C/JVM ICU offsets, local offsets and transitions; managed handles; compiled provider probes | Clock/default-zone bindings and provider selection in the compiler/build pipeline; calendar and additional Intl primitives                                                                                                 |
| Date                    | Scalar constructor/UTC operations; UTC/local arithmetic; TimeClip; ISO/legacy parsing and serialization; typed private-state class                                                 | Standard builtin binding, preserving supplied argument counts; Intl-backed locale methods; named-zone validation                                                                                                           |
| Temporal ISO            | Exact Instant parsing/formatting, range checks, rounding and time-unit arithmetic; one immutable Duration representation with cached exact time; library-derived typed classes     | Compiler support for canonical Temporal unions; complete Instant, relative Duration and all Plain types; adapt pinned upstream algorithms where appropriate                                                                |
| Zoned/calendar Temporal | Shared gap/overlap disambiguation; direct ICU transitions                                                                                                                          | ZonedDateTime, Now, non-ISO calendar conversion and arithmetic                                                                                                                                                             |
| Intl                    | C/JVM number skeleton and exact decimal primitives; UTF-16 spans; shared reusable number partitioning                                                                              | Complete Locale, Collator, NumberFormat, PluralRules, DateTimeFormat, RelativeTimeFormat, ListFormat, DisplayNames, Segmenter and DurationFormat; canonicalization, supportedValuesOf, ranges, parts and toLocale bindings |
| Packaging/performance   | Hashed acquisition; native static build; generated Java bindings; C RC + sanitizers; JVM verification; Android API 29 dex/resource probe; compiled formatter benchmark             | Automatic reachability-controlled packaging; Android device matrix and desugaring audit; other native platforms; startup, heap and artifact-size measurements                                                              |

NTS's fixed-width 128-bit BigInt covers Temporal's timestamp domain, but is not
arbitrary-precision ECMAScript BigInt. General external inputs/intermediates
remain a compiler prerequisite. The JVM fix accompanying this work routes
value-producing ordered BigInt comparisons through its existing exact comparator.

## Verification

Test262 supplies semantic conformance cases. The existing adapter now has Date
and Temporal profiles; it installs the candidate inside each test realm. It
retains failures and reports `host-pass`, never compiled standard-builtin passes.
Date uses an explicitly injected UTC zone. Unsupported `$262` realms remain
visible. No replacement conformance package or separate test corpus was added.

At Test262 revision `14e8c908e54ae2e770e473bcacf536f8cb654929`:

| Host slice        | Passes | Failures |
| ----------------- | -----: | -------: |
| Date              |    576 |       18 |
| Temporal.Instant  |    433 |       32 |
| Temporal.Duration |    394 |      146 |

Those counts are the pre-audit reflective-facade baseline. The post-refactor
counts below retain metadata, intrinsic graph and supported semantic failures.
Date needs original supplied-argument counts and conversions at its standard
builtin boundary. Temporal also lacks Plain/Zoned APIs, relative calendar
arithmetic and localized/zone formatting. Semantic gaps within
the typed profile still require implementation. Intrinsic graph, descriptors,
realms and function metadata are outside that profile and must remain identified
as such; chasing their host pass counts must not dictate the production design.
Temporal is no longer classified as a permanent non-goal; the ordinary scheduler
also no longer excludes all `intl402` tests before attempting them.

The original eight-probe emitted-code fixture reached 261 cases on each backend.
It now also imports the actual public classes and exercises library option
layouts. Public compilation is currently blocked by `NTS1001` on canonical
Temporal unions. Before adopting the canonical unions, the public fixture
exposed a C record-layout mismatch (18 Instant disagreements) and JVM record
casts (10 aborts), plus unfinished cases. Those are compiler/integration defects,
not passing validation. A fraction-padding loop caused 17 C timeouts: the emitted
loop failed to retain the counter increment in its condition. Padding now uses
one bounded power-of-ten multiplication instead. The compiler reproducer is
[`a-postfix-increment-in-a-loop-condition-is-not-carried`](../../tooling/conformance/outcomes/a-postfix-increment-in-a-loop-condition-is-not-carried/src/main.ts)
at commit `9ef297662`; the compiler lane identified shared lowering as the cause,
affecting C, LLVM and JVM. An AST audit of all
34 TypeScript files under `runtime/ecmascript` checked 98 while/do-while/for
headers and found no remaining increment/decrement expressions in loop tests.
The current canonical-API
refusals prevent a complete differential rerun; that remains required.
Provider probes verify
compiled TS calls, New York DST gaps and
overlaps, transitions, exact decimal formatting above 2^53 and UTF-16 parts with
astral mathematical digits. Native verification enables RC, ASan, UBSan and leak
detection; a wrong result, compiler refusal or sanitizer diagnostic fails.

```sh
pnpm exec tsc -p runtime/ecmascript/tsconfig.json
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/Date
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/Temporal/Instant
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/Temporal/Duration
NTS_BACKEND=c NTS_TSGO=target/tsgo target/release/nts check tooling/conformance/ecmascript/date-compiled/tsconfig.json
NTS_BACKEND=jvm NTS_TSGO=target/tsgo target/release/nts check tooling/conformance/ecmascript/date-compiled/tsconfig.json
node runtime/ecmascript/tools/build-icu.ts
node runtime/ecmascript/tools/icu.ts --pinned-native --sanitize
node runtime/ecmascript/tools/icu.ts --pinned-native --bench
node runtime/ecmascript/tools/icu.ts --pinned-native --android
```

`--regenerate-bindings` refreshes the `.d.ts` and `.bind` together after a provider
change. Do not format generated declarations independently: the binding table
records byte offsets in those exact declarations. `icu.ts` checks for drift.
The default native probe permits an installed ICU matching the runtime pin;
production/reproducibility checks use `--pinned-native`.

A local 50,000-call reused-formatter sample with installed ICU 78.3 measured about
272 ns/format on C RC and 392 ns/format on JVM after warmup, with matching
checksums. This is a microbenchmark, not a throughput or memory guarantee for the
whole API. The probe exposes `--bench` for repeatable measurement.

The Android probe contains dex and all ICU resources, with its license, and
checks that no JVM `.class` files remain. It is dex/package evidence, not device
execution. The ordinary APK packager now copies dependency resources and all
generated dex files, preserves licenses and rejects conflicting resource bytes.
Existing pinned-jar packaging checks passed with resource/license assertions.
API 29/30/33/current device execution,
desktop Java 11/current LTS and other native-platform validation remain open.

## Compiler integration boundary

Bind supported standard paths to typed classes and the same scalar core. Apply
the supported scalar conversions at the builtin boundary and preserve instance
branding through the normal class/descriptor machinery. Date's
managed representation must become mutable for setters; the existing JVM
`NtsDate.ms` is final. Compile-time TS builtin inclusion/provider selection must
preserve reachability, so UTC Date arithmetic does not pull ICU into a product.

The previous Date/Temporal facades used reflection, descriptors, WeakMap
branding and constructor casts; those have been removed. RegExp's generic host
facade still uses reflection and needs its own typed-boundary rewrite. The
replacement APIs must compile through their actual public imports on C and JVM,
not just through separate scalar probes. Canonical library unions are supported
TypeScript requirements; excluded metaobject behavior is not a prerequisite.

## Type and contract audit

All authored TypeScript declarations and classes under `runtime/ecmascript`
were checked against the pinned TypeScript 7.0.2 libraries, including provider
bindings and build tools. `lib.esnext.temporal.d.ts` is already available through
ESNext; no additional package or copied declaration file is needed.

| Area                              | Change or reason to retain                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duration inputs                   | Removed the local `DurationLike` union. Parameters use `Temporal.DurationLike` directly; our class also satisfies its standard field-object branch.                                                              |
| Instant inputs                    | Removed the local `InstantLike` alias. Parameters use `Temporal.InstantLike` plus the shared `Instant` representation.                                                                                           |
| Unit and option declarations      | Removed copied unit, precision, field and options interfaces. Methods use `Temporal.PluralizeUnit`, library options and `Temporal.DurationLikeObject` directly. `Readonly` expresses immutable input views.      |
| `DateFields`                      | Removed this unnecessary convenience record and factory. Local construction accepts numeric components and an explicit zone.                                                                                     |
| `DateComponent`                   | Derived with `Exclude<Temporal.DateUnit \| Temporal.TimeUnit, "week" \| "microsecond" \| "nanosecond">`; Date has neither week setters nor precision below milliseconds.                                         |
| `RoundingMode`                    | Internal repeated scalar parameter type, derived from `Temporal.RoundingOptions<Temporal.TimeUnit>["roundingMode"]`; no copied nine-value union or public renaming alias.                                        |
| Disambiguation                    | Removed the one-use alias; the parameter indexes `Temporal.DisambiguationOptions` directly.                                                                                                                      |
| Relative options                  | Removed `IsoRelativeOptions` and its local string-only restriction. Use canonical readonly relative, rounding and total options. Relative/calendar algorithms remain explicitly unfinished.                      |
| Formatter types                   | Removed `DateFormatter` and `FormatPart`. Provider parts use `Omit<Intl.NumberRangeFormatPart, "source">`, including the library's `approximatelySign`. Range source attribution belongs to the range algorithm. |
| RegExp indices                    | Index pairs derive from `RegExpIndicesArray[number]`. The named-group map still needs a corrected type: the pinned library excludes undefined for nonparticipating named captures.                               |
| RegExp match results              | Metadata derives from `RegExpExecArray`; retain a corrected array element union for unmatched captures. The pinned `Array<string>` declaration is inaccurate here.                                               |
| RegExp replacers                  | The library callback uses `any[]`. The existing facade's `unknown[]` adapter is still an erased boundary needing a typed callback/builtin-lowering design; importing `any` would not fix it.                     |
| Clock and time-zone rules         | Retain `TimeHost` and `TimeZoneRules`. These are host/provider capabilities, not ECMAScript value interfaces. All concrete zones implement `TimeZoneRules`.                                                      |
| Number provider                   | Retain `NumberFormatterPrimitive`. Native and JVM adapters implement it; it describes ICU text/field-span operations, not the public Intl API.                                                                   |
| Foreign handles                   | Retain distinct nominal types and type-only brands. No library type describes a managed ICU payload. Negative type checks reject `{}` and cross-family handle assignments.                                       |
| Internal classes and tool records | Parser nodes, instruction programs, match buffers, Unicode tables, scanners and provider/build artifact records have no standard-library equivalent. Their physical storage is intentional.                      |

`NtsDate` checks its supported instance API against `Date`, excluding the
documented metadata/legacy and pending locale/Temporal bridge members. Its
nullable `toJSON` result corrects the pinned library's string-only declaration.
`Duration` and `Instant` check the standard supported method and field contracts.
The type-only `WithResult` transformation binds standard object results to the
shared classes, preserving both overloads of the pinned methods. It copies no
member declarations and emits no allocation or code. Locale methods, zoned
conversion and intrinsic metadata omissions are explicit.

The RegExp facade checks its supported source/flags/test contract, and its
iterator implements the standard `IterableIterator` contract with the corrected
match result. It cannot honestly claim the whole `RegExp` interface yet: its
host prototype compatibility widens flag getters and `lastIndex`, while capture
result typing differs from the pinned library. `NumberFormatter` is a typed
provider integration helper; it lacks standard constructor/options resolution,
BigInt/string dispatch, bound formatting and range APIs. Neither class gains
throwing stubs merely to satisfy a full `implements` declaration.

Strict checking passed for the runtime source, C/JVM adapters, generated
declarations, tools and integration fixtures. The ICU fixture, including nominal
handle type checks, passes C RC with ASan/UBSan/leak checks and JVM verification.
Post-refactor original Test262 host slices report Date **368/226**,
Instant **382/83** and Duration **347/193** passes/failures. These include retained
profile divergences and semantic gaps; they are not compiled conformance results.

Both emitted backends currently report `NTS1001` for canonical
`Temporal.DurationLike`, Instant/Zoned input unions and relative/time-zone option
unions. These declarations are valid TypeScript. The production API retains
canonical types; supporting their representation and builtin bindings belongs
to compiler integration. Earlier literal field records entering erased unions
were not projected into the expected record layout: C ignored the supplied
second and JVM threw a class cast. The public fixture retains that trigger for
verification after compiler support lands. A zero-diagnostic scalar/provider
probe cannot establish that these public paths work.

## Architecture correction status

The audit covers Date, Temporal, Intl providers and the earlier RegExp facade.
The pure algorithms, exact-time helpers, typed buffers and provider separation
remain useful. The public facades are the main architectural problem.

1. Done: Date, Instant and Duration own private state and reuse library types.
   Descriptor patches, dynamic prototype construction, reflective coercion and
   WeakMap state are removed. Duration has one representation; its obsolete
   wrapper file and `DurationRecord` export alias are removed.
2. Done: fixed ICU handle typing and provenance. The previous empty handle type
   admitted `{}` and mixed number/time-zone handles. The distinct handle types
   now use type-only brands over managed foreign references. Native
   accessors validate boxed kind and cleanup-owner identity before casting,
   including release builds. The nullable time-zone ID declaration matches its
   native result and is checked by the adapter. No fake payload field is used.
3. Done: removed eager Date-to-Temporal coupling and descriptor namespace setup;
   the namespace is an ES module export. Provider selection and reachability
   must keep UTC operations independent of optional Temporal and ICU code/data.
4. Pending: rewrite the typed boundary of `src/regexp/builtins.ts`. It already
   owns private state, but still uses `Reflect.apply`, dynamic species and
   unchecked constructor casts. Keep its shared parser/matcher and reusable
   typed matching buffers. Bind supported default paths to typed operations.
5. In progress: public imports now have integration probes. Resolve canonical
   union and record-projection compiler gaps and validate C/JVM execution before
   extending the API. Use original Test262 semantic cases; keep documented
   metaobject non-goals separate from missing supported behavior. Treat refused
   exports, timeouts and unvisited cases as incomplete validation even if the
   differential command exits successfully. Host pass counts are supplementary.

Allocation review found avoidable per-instance side tables and Duration's
temporary ten-element field array plus wrapper allocation. Named field reads
and directly owned immutable state avoid that work. Normalized duration time is
cached in the same immutable object; its C layout is 128 bytes, including the
exact-time field. Public unit and precision inputs derive from the libraries.
Intl partition names derive from the standard range part type, retaining its
approximation marker.

Array `push` is appropriate for compilation builders and outputs with unknown
length; it is not independently evidence of a performance problem. Keep
exact-size output allocation and reusable scratch where sizes are known. Measure
construction, `formatToParts`, heap, startup and artifact size alongside reused
`format` throughput before making broader performance claims. The existing
format microbenchmark does not establish those costs.

For Intl, build normalized formatter configuration in shared code, then ask ICU
for data/text and UTF-16 field spans. Shared code owns JS result objects,
resolved options and partitioning. Exact decimal/BigInt inputs must stay exact
across the boundary. Add one constructor at a time and run its original
`intl402` slice through compiled standard bindings before advertising support.
