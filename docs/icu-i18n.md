Yes. For the runtime you’re building, **ICU is extremely useful**—especially because you have both a native/LLVM backend and a JVM backend.

The clean architecture is:

```text
TypeScript
   ↓
HIR
   ↓
ECMAScript runtime intrinsics
   ├── LLVM/native → ICU4C
   └── JVM         → ICU4J
```

I would **not expose ICU concepts directly in HIR**. Define ECMAScript-semantic runtime operations, then implement those operations using ICU on each backend.

ECMA-402 itself was explicitly designed around functionality found in libraries such as ICU, Java, and .NET. ([TC39][1])

## 1. The biggest win: almost all of `Intl`

This is ICU's natural territory.

| ECMAScript API             | ICU backend                                        |   Fit |
| -------------------------- | -------------------------------------------------- | ----: |
| `Intl.Collator`            | ICU Collator / `ucol_*`                            | ★★★★★ |
| `Intl.NumberFormat`        | NumberFormatter / `unumf_*`                        | ★★★★★ |
| `Intl.DateTimeFormat`      | DateFormat, Calendar, TimeZone, pattern generation | ★★★★★ |
| `Intl.PluralRules`         | PluralRules / `uplrules_*`                         | ★★★★★ |
| `Intl.RelativeTimeFormat`  | RelativeDateTimeFormatter / `ureldatefmt_*`        | ★★★★★ |
| `Intl.ListFormat`          | ListFormatter / `ulistfmt_*`                       | ★★★★★ |
| `Intl.DisplayNames`        | LocaleDisplayNames + ICU locale data               | ★★★★☆ |
| `Intl.Locale`              | Locale / LocaleBuilder / locale APIs               | ★★★★★ |
| `Intl.Segmenter`           | BreakIterator / `ubrk_*`                           | ★★★★★ |
| `Intl.DurationFormat`      | MeasureFormat + NumberFormatter + locale data      | ★★★☆☆ |
| `Intl.getCanonicalLocales` | ICU locale/language-tag APIs                       | ★★★★★ |
| `Intl.supportedValuesOf`   | ICU enumeration/data APIs                          | ★★★★☆ |

Those are exactly the current family of ECMA-402 service constructors. ([TC39][1])

### `Intl.Collator`

This is probably the cleanest mapping.

```ts
new Intl.Collator("de", {
  sensitivity: "base",
  numeric: true,
  caseFirst: "upper",
}).compare(a, b);
```

maps naturally onto ICU collation.

ICU supports locale-specific ordering, numeric ordering, collation variants, case ordering, etc. ([Unicode Consortium][2])

It also gives you:

```ts
"ä".localeCompare("z", "de");
```

because ECMA-402 defines `String.prototype.localeCompare()` in terms of `Intl.Collator`. ([TC39][1])

---

## 2. `Intl.NumberFormat`

Use ICU heavily here.

It covers:

```ts
new Intl.NumberFormat("de-DE").format(123456.78);

new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
}).format(42);

new Intl.NumberFormat("en", {
  notation: "compact",
}).format(1_200_000);

new Intl.NumberFormat("en", {
  style: "unit",
  unit: "kilometer-per-hour",
});
```

ICU's modern NumberFormatter handles decimal, currencies, units, percentages, scientific notation and compact notation. ([Unicode Consortium][3])

That also gives you implementations for:

```ts
Number.prototype.toLocaleString();
BigInt.prototype.toLocaleString();
```

because ECMA-402 defines both using `Intl.NumberFormat`. ([TC39][1])

One important detail: **BigInt must not pass through `double`**.

For:

```ts
123456789012345678901234567890n.toLocaleString();
```

you need ICU's arbitrary-precision/decimal-string formatting path or an adapter around it. Converting the value to IEEE-754 first would break ECMAScript semantics.

---

## 3. `Intl.DateTimeFormat`

Another major use.

ICU gives you:

- IANA time zones
- DST rules
- calendars
- localized month/day names
- localized patterns
- hour cycles
- time-zone names
- date intervals
- numbering systems

ICU's time zone database is derived from the IANA tz database. ([Unicode Consortium][4])

So:

```ts
new Intl.DateTimeFormat("el-GR", {
  timeZone: "Europe/Athens",
  dateStyle: "full",
  timeStyle: "long",
}).format(date);
```

is very much an ICU operation.

It also provides the substrate for:

```ts
Date.prototype.toLocaleString();
Date.prototype.toLocaleDateString();
Date.prototype.toLocaleTimeString();
```

which ECMA-402 specifies in terms of `Intl.DateTimeFormat`. ([TC39][1])

### But don't use ICU to implement core `Date`

This distinction is important.

Use ICU for:

```text
Date → localized representation
timestamp + timezone → calendar fields
timezone offset lookup
calendar formatting
```

But implement these yourself according to ECMA-262:

```ts
Date.now();
date.getTime();
date.setTime();
Date.parse(); // ECMAScript-specific parsing rules
Date.UTC();
TimeClip;
```

ICU date parsing is **not** equivalent to JavaScript `Date.parse()`.

---

# 4. `Intl.Segmenter` → ICU BreakIterator

This is almost tailor-made.

```ts
new Intl.Segmenter("th", {
  granularity: "word",
});

new Intl.Segmenter("en", {
  granularity: "grapheme",
});
```

ICU has break iterators for:

- grapheme boundaries
- words
- sentences
- lines

and dictionary-based segmentation for languages such as Thai, Chinese, Japanese and Khmer. ([Unicode Consortium][5])

So internally you could have:

```text
EsSegmenterCreate(locale, GRANULARITY_GRAPHEME)
EsSegmenterNext(handle, string, position)
```

Native:

```text
ubrk_open(...)
ubrk_next(...)
```

JVM:

```java
com.ibm.icu.text.BreakIterator
```

This is much better than trying to implement UAX #29 yourself.

---

# 5. `String.prototype.normalize()`

Absolutely use ICU.

ECMAScript requires:

```ts
s.normalize("NFC");
s.normalize("NFD");
s.normalize("NFKC");
s.normalize("NFKD");
```

The specification explicitly requires Unicode normalization forms. ([TC39][6])

ICU `Normalizer2` directly supports Unicode normalization. ([Unicode Consortium][7])

Your runtime abstraction could simply be:

```text
EsStringNormalize(
    EsString input,
    NormalizationForm form
) -> EsString
```

implemented by `Normalizer2` on both ICU4C and ICU4J.

This is one of the places where I would not write my own implementation.

---

# 6. `toUpperCase()` / `toLowerCase()`

Also a strong ICU use case.

These:

```ts
s.toUpperCase();
s.toLowerCase();
```

require **full Unicode default case conversion**, including mappings that can change string length:

```ts
"straße".toUpperCase();
// STRASSE
```

ECMAScript explicitly bases these operations on Unicode default case conversion and `SpecialCasing.txt`. ([TC39][8])

ICU implements full Unicode string case mappings, including context-sensitive mappings. ([Unicode Consortium][9])

Use the locale-neutral/root ICU mapping for these.

Then use locale-sensitive ICU mappings for:

```ts
s.toLocaleUpperCase("tr");
s.toLocaleLowerCase("tr");
```

For example Turkish dotted/dotless I is exactly the sort of problem ICU handles. ECMA-402 specifically allows locale-sensitive special casing here. ([TC39][1])

So I'd have four runtime operations:

```text
es_string_lowercase(s)
es_string_uppercase(s)

es_string_locale_lowercase(s, locale)
es_string_locale_uppercase(s, locale)
```

rather than passing some arbitrary locale into the first two.

---

# 7. Compiler lexer: Unicode identifiers

ICU can also help **at compile time**, not just runtime.

JavaScript identifiers include Unicode:

```ts
const π = 3.14;
const κόσμος = "...";
const 日本語 = "...";
```

ECMAScript defines identifiers using Unicode:

```text
ID_Start
ID_Continue
```

plus `$` and `_`. ([TC39][10])

ICU exposes Unicode properties via APIs such as `u_hasBinaryProperty()`. ([Unicode Consortium][11])

So your TS lexer could conceptually use:

```text
isIdentifierStart(cp):
    cp == '$'
    || cp == '_'
    || UnicodeProperty(cp, ID_Start)

isIdentifierContinue(cp):
    cp == '$'
    || cp == '_'
    || UnicodeProperty(cp, ID_Continue)
```

### I would probably not invoke ICU for every source character

Instead, at compiler-build time:

```text
Unicode/ICU data
      ↓
generate compressed range tables
      ↓
TS lexer
```

Something like:

```cpp
static const Range ID_START_RANGES[] = {
   ...
};
```

will be much cheaper.

ICU is excellent as your **authoritative source/generator**, but there's little benefit to an FFI/runtime call per lexer character.

---

# 8. RegExp `\p{...}` and `\P{...}`

ICU is useful here, but **don't use the ICU regex engine as your JS regex engine**.

For example:

```ts
/\p{Script=Greek}+/u
/\p{Letter}/u
/\p{Emoji}/v
```

You can use ICU Unicode properties / `UnicodeSet` machinery to construct the character sets. ICU's `UnicodeSet` can build sets based on Unicode properties. ([Unicode Consortium][12])

So:

```text
JS regexp parser
      ↓
\p{Script=Greek}
      ↓
Unicode property resolver
      ↓
ICU / generated Unicode tables
      ↓
regexp character-set representation
```

is excellent.

But:

```text
JS regexp
     ↓
ICU Regex
```

is **not** something I'd recommend.

ICU regex semantics differ from ECMAScript in important places.

For instance ICU's case-insensitive regexp matching can use **full case folding**, including mappings like:

```text
ß ↔ ss
```

in certain contexts. ([Unicode Consortium][13])

ECMAScript `/u` and `/v` case-insensitive matching instead uses **simple/common case folding**, specifically so one code point stays one code point; `ß` does not simply become `ss` there. ([TC39][14])

So:

> Use ICU's Unicode database for your regexp engine, not ICU's regexp semantics.

---

# 9. RegExp `i` case folding

Again, ICU data is useful, but implement the ECMAScript algorithm.

For:

```ts
/foo/i / foo / ui / foo / vi;
```

ECMAScript actually has subtly different folding behavior.

For Unicode-mode regexps (`u` or `v`), the specification uses the **simple/common mappings from `CaseFolding.txt`**. ([TC39][14])

You can obtain/generate those mappings using Unicode/ICU data.

I would generate something like:

```text
simple_case_fold[codepoint] -> codepoint
```

at compiler/runtime build time.

Don't call:

```text
icuFullCaseFold(string)
```

during JS regexp matching.

That would not be the same semantics.

---

# 10. `Intl.PluralRules`

Very good match.

```ts
new Intl.PluralRules("en").select(1); // one
new Intl.PluralRules("en").select(2); // other
```

and ordinal:

```ts
new Intl.PluralRules("en", {
  type: "ordinal",
}).select(3);
```

map to ICU's PluralRules.

ICU4C even exposes:

```text
uplrules_open()
uplrules_openForType()
uplrules_select()
uplrules_selectForRange()
```

directly. ([Unicode Consortium][15])

This is essentially what you want.

---

# 11. `Intl.RelativeTimeFormat`

Again direct:

```ts
const f = new Intl.RelativeTimeFormat("en");

f.format(-1, "day");
// "1 day ago"

f.format(2, "week");
// "in 2 weeks"
```

ICU has `RelativeDateTimeFormatter` / `ureldatefmt_*`. ([Unicode Consortium][15])

---

# 12. `Intl.ListFormat`

Direct:

```ts
new Intl.ListFormat("en", {
  type: "conjunction",
}).format(["A", "B", "C"]);
// "A, B, and C"
```

ICU exposes `ListFormatter` and `ulistfmt_*`. ([Unicode Consortium][15])

This is another nearly one-to-one mapping.

---

# 13. `Intl.Locale`

ICU can do most of the heavy lifting for:

```ts
new Intl.Locale("zh-Hant-TW");
new Intl.Locale("en-u-ca-gregory-nu-latn");

locale.language;
locale.script;
locale.region;
locale.calendar;
locale.numberingSystem;
locale.maximize();
locale.minimize();
```

You get:

- BCP 47 parsing
- canonicalization
- Unicode locale extensions
- likely-subtags
- language/script/region
- locale matching

ICU has `LocaleBuilder` with BCP 47 language-tag handling. ([Unicode Consortium][16])

It also has APIs such as:

```text
uloc_forLanguageTag
uloc_addLikelySubtags
uloc_canonicalize
```

among others. ([Unicode Consortium][15])

You still need an **ECMA-402 adapter layer** because what JS considers valid/canonical and what arbitrary ICU functions accept aren't necessarily identical.

---

# 14. `Intl.DisplayNames`

For:

```ts
const names = new Intl.DisplayNames("el", {
  type: "region",
});

names.of("FR");
```

and:

```text
language
region
script
currency
calendar
dateTimeField
```

ICU/CLDR has the underlying localization data.

This is exactly the kind of large locale-data database you don't want to reproduce yourself.

---

# 15. `Intl.DurationFormat`

This one needs more glue.

Modern ECMAScript includes:

```ts
new Intl.DurationFormat(...)
```

ECMA-402 included it by 2025. ([TC39][1])

ICU has a class named `DurationFormat`, but **don't use it** for this—it is deprecated and describes somewhat different functionality. ICU recommends `MeasureFormat` or `RelativeDateTimeFormatter` instead. ([Unicode Consortium][17])

For ECMAScript I'd build DurationFormat from:

```text
ICU MeasureFormat
+ NumberFormatter
+ ListFormatter
+ CLDR data
+ ECMA-402's field/style rules
```

So this is an example of:

> ICU supplies the localization machinery, while your runtime supplies the JavaScript semantics.

---

# 16. Unicode character properties

ICU is useful for many internal operations.

For example:

```text
General_Category
Script
Script_Extensions
Alphabetic
Lowercase
Uppercase
White_Space
ID_Start
ID_Continue
Emoji
Emoji_Presentation
Default_Ignorable_Code_Point
...
```

These can support:

- lexer identifier recognition
- RegExp Unicode properties
- regexp case folding
- tooling
- future Unicode-aware standard APIs

However, I'd usually **generate static runtime/compiler tables from Unicode data** where the operation is hot.

---

# 17. `String.isWellFormed()` / `toWellFormed()`

You don't really need ICU here.

ECMAScript strings are sequences of **UTF-16 code units**, and may legally contain unpaired surrogates.

For example:

```ts
"\uD800".isWellFormed();
// false

"\uD800".toWellFormed();
// "\uFFFD"
```

This is trivial to implement as a UTF-16 scan.

Conceptually:

```cpp
for (i = 0; i < length; ++i) {
    u16 c = data[i];

    if (isLeadSurrogate(c)) {
        if (i + 1 < len && isTrailSurrogate(data[i + 1]))
            ++i;
        else
            invalid();
    } else if (isTrailSurrogate(c)) {
        invalid();
    }
}
```

The standard has an explicit `isWellFormed` operation. ([TC39][8])

I'd keep this completely inside your own string runtime.

---

# 18. Don't use ICU for ordinary JS String semantics

This is probably the biggest implementation warning.

JavaScript strings are fundamentally indexed by **UTF-16 code units**, not Unicode grapheme clusters and not necessarily Unicode scalar values.

So don't use ICU for:

```ts
s.length;

s.charAt(i);
s.charCodeAt(i);

s.at(i);

s.slice();
s.substring();

s.indexOf();
s.lastIndexOf();

s.startsWith();
s.endsWith();
s.includes();
```

Those should operate on your own `EsString` representation.

For example:

```ts
"😀".length === 2;
```

must remain true.

And:

```ts
"😀".charCodeAt(0);
```

must expose the lead surrogate.

ECMAScript explicitly defines String operations in terms of code units, and unpaired surrogates remain representable. ([TC39][18])

---

# 19. This strongly suggests UTF-16 for your runtime string ABI

For your particular architecture, I would seriously consider:

```text
EsString {
    length: u32       // UTF-16 code units
    data: *u16
}
```

at least as the **semantic representation**.

You could internally optimize with:

```text
Latin-1 strings
ropes
slices
SSO
UTF-16 flat strings
```

but observable indexing should always be UTF-16.

This has a nice side effect:

### JVM

Java `String` already exposes UTF-16 code-unit semantics:

```java
length()
charAt()
```

and can contain unpaired surrogates.

### Native

ICU4C's traditional string APIs use `UChar`, which is 16-bit UTF-16. ICU collation commonly expects UTF-16 as well. ([Unicode Consortium][19])

So the semantic boundary becomes very natural:

```text
JS String
   │ UTF-16
   ├── your normal string operations
   └── ICU
```

## Avoid an intermediate UTF-8 conversion

Especially for arbitrary JS strings.

This:

```text
JS UTF-16 containing lone surrogate
        ↓
UTF-8
        ↓
ICU
```

can accidentally repair/replace invalid surrogate sequences.

That's an observable semantic bug.

---

# 20. Temporal/time-zone support

If you're implementing `Temporal`, ICU can be useful underneath it for:

- time-zone identifiers
- offset transitions
- IANA tzdb data
- non-Gregorian calendars
- localized formatting

But I would **not implement Temporal arithmetic by just calling ICU Calendar**.

Your architecture should look more like:

```text
Temporal.Instant
Temporal.PlainDate
Temporal.ZonedDateTime
        │
        ├── ECMAScript-defined arithmetic
        ├── ECMAScript-defined rounding
        ├── ECMAScript-defined overflow behavior
        │
        ├── ICU timezone lookup
        └── ICU calendar/Intl formatting where appropriate
```

Again:

> ICU as data/algorithm substrate, ECMAScript as semantic authority.

---

# 21. What I'd put in your HIR/runtime ABI

I wouldn't make calls like:

```text
hir.icu.collator(...)
```

Instead:

```text
es.string.normalize
es.string.to_lower
es.string.to_upper
es.string.to_locale_lower
es.string.to_locale_upper

es.unicode.get_property
es.unicode.simple_case_fold

es.intl.locale.create
es.intl.locale.maximize
es.intl.locale.minimize

es.intl.collator.create
es.intl.collator.compare

es.intl.number_format.create
es.intl.number_format.format
es.intl.number_format.format_parts
es.intl.number_format.format_range

es.intl.datetime_format.create
es.intl.datetime_format.format
es.intl.datetime_format.format_parts
es.intl.datetime_format.format_range

es.intl.plural_rules.create
es.intl.plural_rules.select

es.intl.relative_time.create
es.intl.relative_time.format

es.intl.list_format.create
es.intl.list_format.format

es.intl.segmenter.create
es.intl.segmenter.next

es.intl.display_names.create
es.intl.display_names.of
```

Then:

```text
                   HIR
                    │
          ECMAScript runtime ABI
             /             \
            /               \
      Native runtime       JVM runtime
           │                    │
        ICU4C                 ICU4J
```

That gives you enormous flexibility.

---

# 22. Native side: prefer ICU's C API

For the LLVM/native runtime I'd generally prefer:

```text
ICU4C C API
```

over exposing ICU C++ types across your compiler/runtime ABI.

So use things like:

```text
ucol_*
unorm2_*
ubrk_*
unumf_*
udat_*
uplrules_*
ureldatefmt_*
ulistfmt_*
uloc_*
```

and keep `UCollator*`, `UBreakIterator*`, etc. completely hidden inside your runtime.

For example:

```cpp
struct EsCollator {
    UCollator* icu;
};
```

HIR sees only:

```text
EsIntlHandle
```

not `UCollator*`.

---

# 23. JVM side: use ICU4J, not `java.text.*`, if parity matters

You could map:

```text
LLVM → ICU4C
JVM  → java.text / java.time
```

but then you'll get observable differences.

I'd instead use:

```text
LLVM → ICU4C
JVM  → ICU4J
```

where possible.

That gets you much closer in:

- CLDR versions
- collation
- segmentation
- locale canonicalization
- plural rules
- formatting
- supported calendars
- numbering systems

You still shouldn't assume ICU4C and ICU4J are byte-for-byte identical, but it's a much better starting point.

---

# 24. One issue you need to decide early: Unicode/ICU version

This matters for compiler conformance.

Suppose:

```ts
const 𐭔 = 123;
```

and that code point became `ID_Start` in Unicode version N.

If your JVM build uses one Unicode version and native uses another, one backend could accept something the other rejects.

ICU lets you inspect the Unicode version it was built against. ([Unicode Consortium][11])

I would therefore pin:

```text
Compiler Unicode version: X
Runtime Unicode version: X
CLDR version: Y
tzdb version: Z
```

and make them explicit build metadata.

For maximum determinism, generate lexer and RegExp property tables from your chosen Unicode release rather than implicitly inheriting whatever ICU happens to be installed on the host.

---

# 25. My split would be

### Use ICU directly/heavily

```text
Intl.Collator
Intl.NumberFormat
Intl.DateTimeFormat
Intl.PluralRules
Intl.RelativeTimeFormat
Intl.ListFormat
Intl.DisplayNames
Intl.Locale
Intl.Segmenter
Intl.getCanonicalLocales

String.normalize
String.toLowerCase
String.toUpperCase
String.toLocaleLowerCase
String.toLocaleUpperCase
String.localeCompare

Number.toLocaleString
BigInt.toLocaleString
Date.toLocale*
```

### Use ICU/Unicode data as a helper

```text
identifier ID_Start / ID_Continue

RegExp \p{} / \P{}
RegExp Unicode Script / General_Category properties
RegExp simple case-fold tables

Temporal timezone/calendar backing data

Intl.DurationFormat
Intl.supportedValuesOf
```

### Implement yourself

```text
String.length
charAt / charCodeAt
codePointAt
slice / substring
indexOf / includes
String iterator
isWellFormed / toWellFormed

RegExp engine
RegExp parser
JS regexp backtracking/captures/lookarounds
JS regexp i/u/v semantics

Date.parse
core Date arithmetic
core Temporal arithmetic

JS numeric conversions
parseInt / parseFloat
Number()
BigInt()

Array.sort semantics
objects/prototypes
property semantics
equality
coercions
exceptions
Promises
...
```

The core principle is:

> **Use ICU wherever ECMAScript delegates to Unicode, CLDR, locale, collation, segmentation, calendar or time-zone data. Do not delegate to ICU where ECMAScript itself defines observable algorithmic semantics.**

For your two-backend architecture, ICU can probably eliminate **the majority of the difficult ECMA-402 implementation work**, while also giving you the Unicode database you need for the lexer and parts of your RegExp implementation.

[1]: https://tc39.es/ecma402/2025/?utm_source=chatgpt.com "ECMAScript® 2025 Internationalization API Specification"
[2]: https://unicode-org.github.io/icu/userguide/collation/?utm_source=chatgpt.com "Collation | ICU Documentation"
[3]: https://unicode-org.github.io/icu/userguide/format_parse/numbers/?utm_source=chatgpt.com "Formatting Numbers | ICU Documentation"
[4]: https://unicode-org.github.io/icu/userguide/datetime/?utm_source=chatgpt.com "Date/Time | ICU Documentation"
[5]: https://unicode-org.github.io/icu/userguide/boundaryanalysis/?utm_source=chatgpt.com "Boundary Analysis | ICU Documentation"
[6]: https://tc39.es/ecma262/2022/multipage/text-processing.html?utm_source=chatgpt.com "ECMAScript® 2022 Language Specification"
[7]: https://unicode-org.github.io/icu/userguide/transforms/normalization/?utm_source=chatgpt.com "Normalization | ICU Documentation"
[8]: https://tc39.es/ecma262/pr/3715/multipage/text-processing.html?utm_source=chatgpt.com "ECMAScript® 2026 Language Specification"
[9]: https://unicode-org.github.io/icu/userguide/transforms/casemappings.html?utm_source=chatgpt.com "Case Mappings | ICU Documentation"
[10]: https://tc39.es/ecma262/pr/3713/multipage/ecmascript-language-lexical-grammar.html?utm_source=chatgpt.com "ECMAScript® 2026 Language Specification"
[11]: https://unicode-org.github.io/icu-docs/apidoc/released/icu4c/uchar_8h.html?utm_source=chatgpt.com "ICU 78.3: common/unicode/uchar.h File Reference"
[12]: https://unicode-org.github.io/icu-docs/apidoc/dev/icu4c/classicu_1_1UnicodeSet.html?utm_source=chatgpt.com "ICU 78.1: icu::UnicodeSet Class Reference"
[13]: https://unicode-org.github.io/icu/userguide/strings/regexp.html?utm_source=chatgpt.com "Regular Expressions | ICU Documentation"
[14]: https://tc39.es/ecma262/2024/multipage/text-processing.html?utm_source=chatgpt.com "ECMAScript® 2024 Language Specification"
[15]: https://unicode-org.github.io/icu-docs/apidoc/dev/icu4c/globals_u.html?utm_source=chatgpt.com "ICU 78.1: Globals"
[16]: https://unicode-org.github.io/icu-docs/apidoc/dev/icu4c/classicu_1_1LocaleBuilder.html?utm_source=chatgpt.com "ICU 78.1: icu::LocaleBuilder Class Reference"
[17]: https://unicode-org.github.io/icu-docs/apidoc/dev/icu4j/com/ibm/icu/text/DurationFormat.html?utm_source=chatgpt.com "DurationFormat (ICU4J 78)"
[18]: https://tc39.es/ecma262/2026/multipage/ecmascript-data-types-and-values.html?utm_source=chatgpt.com "ECMAScript® 2026 Language Specification"
[19]: https://unicode-org.github.io/icu/userguide/collation/architecture.html?utm_source=chatgpt.com "Architecture | ICU Documentation"
