# Dates, time zones and Intl

Where `Date`, time zones, `Temporal` and `Intl` come from on each target: the
compiler's own `Date`, the shared implementations in `runtime/ecmascript`, the
ICU providers beneath them, and the decisions that govern them. For builtins
and runtime work. The Unicode data underneath (case mapping, normalization,
segmentation rules) is [unicode](unicode.md); how a target chooses one
implementation of a builtin is [builtins](builtins.md).

## Where each comes from

| feature | today | designed or decided |
|---|---|---|
| `Date` as a time value: `new Date(ms)`, `getTime`, `valueOf` | **built on every backend:** the compiler's own | |
| `Date.now()`, `new Date()` | refused, since they read a clock: `Date.now` as a missing builtin (`NTS1100`), `new Date()` as a lowering gap (`NTS1001`) | the clock as a provided capability (decision 2, G12) |
| local time: `getFullYear`, `getHours`, `getTimezoneOffset`, ... | refused by name (`NTS1001`): they need a time-zone database | node's pinned time-zone data, only in programs that use local time (G13) |
| the rest of `Date`: `Date.UTC` (`NTS1100`), `toISOString`, parsing, formatting, setters (`NTS1001`) | refused | `runtime/ecmascript`'s `Date` |
| `Temporal` | refused: not a provided global (`NTS1100`) | `runtime/ecmascript`'s, where the host has none (G15) |
| `Intl` | refused: not a provided global (`NTS1100`) | per target: [below](#intl) |

**The compiler's `Date`** is a header and a double: the specification calls a
date's contents a *time value* and defines every accessor as arithmetic on it.
`TimeClip` (truncation toward zero, `NaN` outside ±8.64 × 10¹⁵ ms) runs once, at
construction, because it is observable: `new Date(1.5).getTime()` is 1.

**`runtime/ecmascript`** implements the whole of `Date`, `Temporal` and
ECMA-402 in TypeScript, over ICU providers. It is tested on the host and in
compiled witnesses, and **no program reaches it yet**: binding these globals
to it is stage 8 of [builtins](builtins.md#stages-smallest-first).

## runtime/ecmascript

**One source for every backend.** ECMAScript's semantics are shared
TypeScript: parsing, validation, option resolution, rounding, clipping,
calendar arithmetic, time-zone disambiguation, and result and parts objects. A
provider supplies only what genuinely crosses into data or text services:

| provider | for | how it is called |
|---|---|---|
| ICU4C (`providers/icu/c`) | native | through nts's ordinary C ABI. C++ stays inside the adapter, behind a narrow C interface |
| ICU4J (`providers/icu/java`) | the JVM and Android | ordinary Java calls; no JNI. The provider needs Java 11; the Java 8 runtime does not depend on it |

- **ICU is a provider, never a requirement of arithmetic.** Gregorian
  arithmetic and ISO-8601 parsing do not use ICU or a host `Date`, so a program
  that only uses UTC and ISO forms acquires no ICU.
- **The environment is injected.** The clock, the default locale and the
  default time zone come from an injected host (`TimeHost`), and
  `Temporal.Now` takes a nanosecond clock and a default zone the same way.
- **State is typed and private.** A `Date` owns mutable, clipped milliseconds;
  a `Temporal` value owns immutable state in private fields, which also brands
  it. No side tables, descriptor patches or prototype set-up.
- **Formatters are made outside hot loops.** Provider handles live as managed
  boxes on native and ordinary objects on the JVM; scratch buffers are reused;
  a parts array is allocated at its exact size.
- **Pinned data:** ICU 78.3 (node's version), with its Unicode, CLDR and
  time-zone database versions, and the test262 revision, are in
  `runtime/ecmascript/providers/icu/versions.json`. The small locale-preference
  index ICU does not expose is generated from pinned CLDR data, and the Chinese
  and Korean calendars' year tables from pinned ICU4X data, both in TypeScript.

## Time zones

A zone is a set of rules (`TimeZoneRules`): its offset at an instant, its
offset at a local time with ICU's former and latter readings at a
discontinuity, and its next or previous transition. The shared code, not the
provider, decides whether a discontinuity is a gap or an overlap and which
instant a local time means. A fixed-offset zone and UTC need no data.

- **Named zones** resolve through an identifier registry that keeps both the
  spelling asked for and the IANA primary identifier, and opened zones are
  cached in a small bounded cache.
- **Local time without Intl** (G13): the recommendation is node's pinned
  time-zone database, emitted as data only into programs that use local time;
  its size is to be measured.
- **Under the differential tests** the zone is fixed to UTC
  ([builtins](builtins.md#the-clock-and-randomness)).

## Intl

**In scope,** with locale subsets keeping it small (decision 1). The services
`runtime/ecmascript` implements are `Collator`, `DateTimeFormat`,
`DisplayNames`, `DurationFormat`, `ListFormat`, `Locale`, `NumberFormat`,
`PluralRules`, `RelativeTimeFormat`, `Segmenter` and `supportedValuesOf`, and
the locale methods of `Number`, `BigInt`, `String`, `Date`, arrays and typed
arrays, all through the same shared services. None of it is bound yet; where
each target's Intl comes from is decided:

| target | Intl comes from | notes |
|---|---|---|
| native (C, LLVM) | ICU4C, node's version, built from its pinned, hash-checked source (D3) | a static C++ standard library, linked only into programs that use Intl |
| JVM, Android | ICU4J, the same version, bundled | not the JDK's, and not the device's; whether a platform's own ICU may ever serve is open (D-3) |
| Wasm in a browser or node, Chromium | the host's `Intl` (decision 3) | zero bytes; results follow the host's ICU, exact under node |
| Wasm, standalone | none (D6) | the Unicode services still work there |

- **Data follows the program** (decided, not built): a program carries locale
  subsets by default, with ICU's fallback, and full data is an opt-in.
  Word-break dictionaries are the exception: they ship whenever a program
  segments words, unless its input is proved free of the scripts that need
  them, because ICU picks a dictionary by the text's script, not by the
  requested locale (D5).
- **Declaring locales** in `nts.config.ts` (default `en`) is the
  recommendation (G14); there is no config field for it yet. Sizes per locale
  are to be measured; [unicode](unicode.md#costs) has the estimates.
- **Before the tables, behaviour matches V8:** locale-list conversion, option
  coercion and getter order, invalid tags and the default locale are audited
  against node before they are bound ([unicode](unicode.md#staying-identical-to-node)).

## Temporal

`runtime/ecmascript` implements `Instant`, `Duration`, `PlainDate`,
`PlainTime`, `PlainDateTime`, `PlainYearMonth`, `PlainMonthDay`,
`ZonedDateTime` and `Now`, with ISO and non-ISO calendars. Calendar data comes
from the ICU providers, and all calendar-bearing values share one calendar
context. Every `Temporal` value localizes through the shared Intl, and keeps
the specified fallback when Intl is absent.

The pinned node has no `Temporal`. Providing it wherever the host lacks it,
node included, goes beyond "behaves like node" and is the user's call (G15),
as is browser support on Wasm.

## Testing

- **test262 on the host:** `tooling/conformance/ecmascript/test262.ts` runs
  test262's original `Date`, `Temporal` and `intl402` tests against the shared
  sources under node. Its verdict is a host pass, not compiled conformance.
- **Compiled witnesses:** `tooling/conformance/ecmascript/` holds projects
  (`compiled`, `date-compiled`, `icu-compiled`) that [`nts check`](../reference/cli.md#nts-check)
  compiles and compares with node on each backend and memory configuration,
  with sanitizers on native and verification on the JVM.
- **Once bound,** each provider keeps a test262 record per backend and host,
  as every provider does ([builtins](builtins.md#testing)).

## Decisions

- **Intl is in scope,** with locale subsets keeping it small
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 1).
- **The clock comes from the environment** (`Date.now`, `new Date()`, local
  time, `performance.now`), with a virtual clock under the differential tests
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 2).
- **On JS hosts, take the host's builtins,** Intl first; on native and
  standalone Wasm, ours
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 3).
- **ICU carries locale subsets by default;** full data is opt-in
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- **D2:** the Unicode version is node's. **D3:** Intl on native uses ICU4C, with
  a static C++ standard library only in programs that use Intl. **D5:**
  word-break dictionaries follow the text. **D6:** no Intl on standalone Wasm
  for now ([log](../records/notebooks/decisions-log.md#unicode-10-27)).
