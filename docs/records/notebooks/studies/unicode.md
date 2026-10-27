# Unicode and text data as a foundation for nts

Research and design study, 2026-10-27. `main` at `b22504de1`. Nothing in the repository was built, benchmarked or edited. Light probes only (listed in §8).

**How to read the numbers.** Every number carries one of four labels:

| label | meaning |
|---|---|
| **measured** | an instrument produced it; the source is named (a repo record, `results/`, or a probe of mine) |
| **computed** | exact output of a script of mine over pinned data files (UCD 17.0, ICU 78.3 data, ICU4X crates); it counts table bytes, not linked binaries |
| **estimated** | argued from evidence, not measured |
| **unverified** | stated by a source I could not check |

**Terms used throughout.**

- **UCD** (Unicode Character Database): the text files Unicode publishes with each version: which characters are letters, their upper- and lowercase forms, their decompositions, and so on.
- **CLDR**: Unicode's *locale* data: how German sorts, how dates read in Greek, where Thai words break.
- **ICU**: Unicode's reference library. ICU4C is the C/C++ edition (node uses it), ICU4J the Java one, ICU4X a newer Rust rewrite.
- **Case mapping**: `toLowerCase`/`toUpperCase`. **Special casing** covers the mappings that are not one character to one character (`ß` → `SS`). **Final_Sigma** is the rule that a Greek capital sigma becomes `ς` at the end of a word and `σ` elsewhere. **Case folding** is the mapping RegExp's `i` flag compares with.
- **Normalization**: `String.prototype.normalize`. It turns `e` + combining accent and the precomposed `é` into one agreed form (NFC, NFD, NFKC or NFKD).
- **Grapheme cluster**: what a user calls one character: `👩‍👩‍👧` is one, though it is seven code units.
- **Trie**: a multi-stage lookup table. The code point is split into bit fields, and each field indexes one stage. Identical blocks are stored once, which keeps the table small; each lookup costs a fixed two or three memory reads.

---

## 1. Summary

**What this is about.** JavaScript needs Unicode knowledge in more places than it seems: case conversion, `normalize`, RegExp's `i`, `u` and `v` flags and `\p{...}`, `localeCompare`, `Intl.Segmenter`, URL hosts and terminal widths. Today nts gets that knowledge from four different places:

- QuickJS's `libunicode` for native case conversion;
- a 191 KB TypeScript file generated from that same `libunicode` for the RegExp engine;
- the JDK's own tables on the JVM;
- the JavaScript host on Wasm.

Each source carries its own Unicode version. Most of the remaining features are refused.

**Answers that are wrong today.**

| defect | backends | how it was established |
|---|---|---|
| Final_Sigma is not implemented: `"ΑΣ".toLowerCase()` gives `ασ`; node gives `ας` | C, LLVM | **measured**: two test262 failures in the recorded results |
| JDK 21 carries Unicode 15.0, so `"Ɤ".toLowerCase()` (a Unicode 16 letter) stays unchanged; node gives `ɤ` | JVM | **measured**: JDK 21 probe |
| the JDK mishandles Final_Sigma after a supplementary combining mark | JVM | **measured**: a recorded test262 failure |
| the unbound Intl provider sends `hy` (Armenian) to ICU, and ICU then uppercases U+0587 differently from node | not bound yet | **measured**: ICU 78.3 probe |

V8 sends only `az`, `el`, `lt` and `tr` to ICU, which is why node and ICU disagree on `hy`.

**The `case-convert` row loses to node and Bun** in the last full run: 3.90 µs against node's 3.13 µs (1.25x) and Bun's 3.73 µs (1.05x) (**measured**, `results/benchmarks/full.md`, run at `833fa3016`). That row is ASCII and never reads a Unicode table. Its loss is in allocation and per-call cost, not in the data. So it cannot decide which table source is faster, which was the criterion the user approved on 10-22. Non-ASCII rows have to be added first, and they will decide it.

**Recommendation.**

1. **Move the UCD into the compiler.** Add a Rust crate, `compiler/unicode`, built from the UCD files of exactly the version node reports (`process.versions.unicode`: 17.0 for the pinned node 24.20.0). It becomes the one source of Unicode data for C, LLVM, JVM and both Wasm profiles.
2. **The compiler emits only the tables a program reaches**, in each backend's own form: C arrays, JVM constants, Wasm data segments.
   - RegExp literals get their character sets compiled into the generated matcher, so they need no runtime table at all.
   - A program that only lowercases carries only the lowercase table.
3. **The runtime keeps small hand-written algorithms.** On native that is C:
   - case mapping, including Final_Sigma and the four locale tailorings V8 applies (`az`/`tr`, `lt`, `el`);
   - normalization;
   - grapheme breaking;
   - RegExp folding;
   - East Asian width.

   The ASCII and Latin-1 paths use SIMD (vector instructions) and return the same string when nothing changes. A TypeScript reference implementation serves the JVM and standalone Wasm, and it is the readable specification.
4. **QuickJS goes in two steps**: case conversion first, then normalization and RegExp data.
5. **ICU stays only for locale (CLDR) services**: collation, word and sentence breaking, and the Intl formatters. It is the vendored ICU4C 78.3 already pinned in `runtime/ecmascript`, which is node's own version, with each program's data cut to the locales it declares. Pure Unicode features never pull in ICU, which is megabytes of data.
6. **Exactness is enforced in three ways**:
   - the UCD pin is checked against the Unicode version of the node in `.tool-versions`;
   - every backend is tested on three layers: Unicode's own conformance files, test262, and an exhaustive comparison with node over every code point.

   Unicode 18.0 (2026-09-16) and ICU 79.1 (2026-10-22) are already out. nts moves to them in the same landing that moves its pinned node.

**Why not the alternatives.**

- **ICU4C for the UCD layer**: megabytes of data and a C++ runtime in every program that lowercases a string.
- **ICU4X**: its current data is already Unicode 18, ahead of node (**measured**, the 2.4.0 crates). Using it at run time also needs prebuilt Rust static libraries for every target inside the `nts` binary. Its data formats change between versions (its segmenter v1 to v2 is one example), while the UCD text files are the stable primary source.
- **libunicode**: it locates each mapping by binary search, has no Final_Sigma, and is a third-party data path that nts cannot cut per program.

ICU4X still has two good uses: a second oracle in the crate's tests, and the natural candidate if standalone Wasm ever needs Intl.

The cost is small (§5): table bytes for case conversion go from about 10 KB today to roughly 10–20 KB, and the Unicode data adds an **estimated** 100–400 KB to the `nts` binary.

---

## 2. Inventory: what needs Unicode data, what nts does today, what is missing

### 2.1 By feature

| Feature | Data or algorithm it needs | Native (C/LLVM) today | JVM today | Wasm (JS host) today | Missing or wrong |
|---|---|---|---|---|---|
| `toLowerCase` / `toUpperCase` | UnicodeData simple mappings, SpecialCasing (unconditional), Final_Sigma context (Cased, Case_Ignorable) | `nts_unicode.c`: ASCII arithmetic, Latin-1 tables, else `lre_case_conv` per code point (binary search over 378 runs), two passes, temporary `malloc`, copy | `String.toLowerCase(Locale.ROOT)` (JDK 21 = Unicode 15.0) | host import calling `String.prototype.toLowerCase` | **C/LLVM**: no Final_Sigma; test262 `special_casing_conditional.js` and `Final_Sigma_U180E.js` fail (**measured**, `results/test262/{c,llvm}/builtins.tsv`). **JVM**: `special_casing_conditional.js` fails; U+A7CB and U+10D50 not mapped (**measured**, JDK 21.0.5 probe) |
| `toLocaleLowerCase` / `toLocaleUpperCase` | SpecialCasing language rules (`tr`/`az`, `lt`); ICU's Greek uppercasing (`el`) | refused (lowering) | refused | refused | All. The unbound TS provider (`runtime/ecmascript/src/intl/string-case.ts`) routes `hy` to ICU too; ICU 78.3 gives U+0535 U+054E for U+0587, node gives U+0535 U+0552 (**measured**) |
| `normalize` | decompositions, canonical combining classes, composition exclusions, Hangul, quick-check flags | refused (3 sites in the node profile); `unicode_normalize` is vendored but unused | refused | refused | All |
| `localeCompare`, `Intl.Collator` | CLDR root collation and tailorings | refused; ICU4C provider exists in `runtime/ecmascript/providers/icu/c`, not bound | refused; ICU4J provider not bound | refused | All |
| RegExp `i` / `u` / `v`, `\p{...}`, `\w` under `ui`, group names | simple case folding (u/v), toUppercase-based Canonicalize (non-u), General_Category, Script, Script_Extensions, 53 binary properties, emoji string properties (v), ID_Start/ID_Continue | RegExp literals refused (no engine bound). TS engine in `runtime/ecmascript/src/regexp` with `unicode-data.ts` (191,394 B, base64, decoded per compilation, generated from libunicode by a C adapter) | same | same (host RegExp not bound either) | All compiled RegExp |
| `trim*`, `\s`, `parseFloat` whitespace | WhiteSpace (fixed plus all of Zs) and LineTerminator | hard-coded set, correct for Unicode 6.3 to 18 | runtime's own set (not checked) | host | Nothing to fix now; a generator should assert Zs so that a new space character fails loudly |
| `isWellFormed`, `toWellFormed`, `codePointAt`, `fromCodePoint`, `at`, iteration, URI functions, JSON well-formed stringify | UTF-16 and UTF-8 only, no tables | done | done | not checked | none known |
| `TextEncoder` / `TextDecoder` | UTF-8 and UTF-16; WHATWG legacy encodings (Encoding Standard index tables, not the UCD) | TS codec in `web-platform/src/core`; `decode` refused when compiled; UTF-8, UTF-16LE and UTF-16BE only | same | same | legacy encodings (`latin1`/`ascii` map to windows-1252); a SIMD codec (simdutf, vendored study) |
| `Intl.Segmenter` grapheme | Grapheme_Cluster_Break, Extended_Pictographic, Indic_Conjunct_Break (UAX #29) | ICU4C provider, not bound | ICU4J, not bound | refused | All |
| `Intl.Segmenter` word and sentence | UAX #29 plus CLDR plus dictionaries (CJK, Thai, Lao, Khmer, Burmese) | ICU provider, not bound | ICU4J, not bound | refused | All |
| URL hosts, `domainToASCII` | UTS #46 mapping table, NFC, Bidi and joiner rules | TS approximation (`runtime/node/url/src/idna.ts`: NFKC plus lowercase plus a hand list); its `normalize("NFKC")` is refused when compiled | same | same | the full mapping table. Node's own URL uses ada-url/idna, not ICU; its Unicode version is **unverified** |
| `util` string width (`console.table`, `inspect`) | East_Asian_Width, emoji presentation, zero-width classes | node's no-ICU fallback ranges in TS (`runtime/node/util/src/width.ts`) plus `normalize("NFC")` (refused) | same | same | ICU-exact widths, which node uses when built with Intl |
| Identifiers in source | ID_Start/ID_Continue | the frontend (tsgo/tsrs, upstream) decides at compile time, with Unicode **15.1** tables | — | — | Upstream gap: 16 test262 identifier tests for Unicode 16/17 are listed as known tsgo gaps in `tooling/census/test262-evidence-overrides.json`. Report it; never patch upstream |
| Intl formatters (Number, DateTime, Plural, List, RelativeTime, Duration, DisplayNames, Locale) | CLDR | ICU4C providers exist (3,172/3,357 intl402 rows on the host), not bound | ICU4J, not bound | refused | binding (compiler lane) |

### 2.2 How libunicode reaches a program today

- **Detection**: `compiler/codegen/c/src/emit.rs` decides `uses_unicode`, a HIR scan for a call to any name `nts_unicode.h` declares, ORed with a scan of the emitted text.
- **Emission**: when true, `support_files` writes `nts_unicode.c` and the `quickjs/` files beside `program.c`. `nts_unicode.c` `#include`s `quickjs/libunicode.c`, so the vendored code is one translation unit (one C source file compiled on its own).
- **Pruning**: builds pass `-ffunction-sections -fdata-sections -Wl,--gc-sections`, and `nts build` uses ThinLTO by default.
- **Cost** (**measured**, `runtime/c/quickjs/README.md`):
  - libunicode is 20,181 B of code and 42,707 B of tables;
  - a case-converting program grows by 10,120 B after section garbage collection (the linker dropping unreferenced code and data), against 81,144 B linked whole;
  - the translation unit compiles in 0.25 s, against `nts_runtime.c`'s 0.40 s.

### 2.3 Unicode versions in play

| Component | Unicode version | Evidence |
|---|---|---|
| node 24.20.0, the oracle pinned in `.tool-versions` | **17.0** (ICU 78.3, CLDR 48.0) | **measured**, `process.versions` |
| Bun 1.4.0 | 17.0 (ICU 78.3); agrees with node on my probes | **measured** |
| quickjs-ng libunicode, pin `776150276` | 17.0 (has Sidetic, Tolong Siki, Beria Erfe, Tai Yo) | **measured**, grep of `libunicode-table.h` |
| `unicode-data.ts` (RegExp TS engine) | 17.0 (derived from libunicode) | generator source |
| ICU provider pins (`runtime/ecmascript/providers/icu/versions.json`) | 17.0 (ICU 78.3, CLDR 48.2) | file |
| test262 pin `14e8c908` property-escape tests | 17.0.0 | header of the generated tests |
| JDK 21.0.5 (the JVM lane's runtime) | **15.0** | **measured**, probe and javadoc |
| tsgo/tsrs identifier tables | **15.1** (`unicode-id-start =1.1.2`) | `third_party/tsrs/Cargo.toml` |
| node's URL IDNA (ada-url/idna) | **unverified** | — |
| Latest Unicode | **18.0**, 2026-09-16; ICU 79.1 (2026-10-22) and ICU4X 2.4.0 (2026-10-22) already ship it | unicode.org, icu.unicode.org, crates.io |

The right pin is the node oracle's version, not the latest one: node is the specification nts is measured against.

---

## 3. State of the art

### 3.1 Comparison

| System | Case mapping | `normalize` | RegExp Unicode data | Locale services | Data source and version | Table technique |
|---|---|---|---|---|---|---|
| **V8 / node** | One-byte strings: ASCII word-at-a-time (`FastAsciiConvert`) plus Latin-1 tables, with ß, µ and ÿ special-cased; a CSA fast path (V8's own builtin language) for strings of 24 characters or fewer returns the original string when unchanged. Two-byte strings: ICU `u_strToLower/Upper` with the root locale. `toLocale*`: only `az`, `el`, `lt`, `tr` go to ICU | ICU Normalizer2 (`getInstance("nfc"/"nfkc", …)`) with `spanQuickCheckYes`. **No one-byte fast path**: the input is always copied into an `icu::UnicodeString` | irregexp: ICU `UnicodeSet` for `\p` and case closure, plus a build-time generated `special-case.cc` that corrects ICU against the specification's Canonicalize | ICU4C. Cached default collator; ASCII fast compare with L1/L3 weight tables. Temporal via temporal_rs (ICU4X) | all ICU (node bundles full ICU, `deps/icu-small`) | ICU's tries |
| **JSC / Bun** | 8-bit strings: scan, return the string itself if unchanged, ASCII lowering, `u_tolower` for Latin-1; ß, µ and ÿ handled on uppercase. 16-bit strings: ICU with the root locale. Locale forms: `tr`/`az`, `lt` (lower), plus `el` (upper) | ICU `unorm2`. 8-bit strings return immediately for NFC (Latin-1 is NFC-stable) and for any form if ASCII; then `unorm2_isNormalized`, then normalize | Yarr: own tables generated from UCD files (`generateYarrUnicodePropertyTables.py`, `generateYarrCanonicalizeUnicode`) | ICU4C; cached collators per locale string | ICU plus WebKit's own UCD copy | ICU tries; Yarr ranges and hashes |
| **SpiderMonkey / Firefox** | own tables generated by `make_unicode.py` from UnicodeData, CaseFolding and SpecialCasing | **ICU4X** since Firefox 150 (bug 1932875; mixed speed against ICU4C; Latin-1 NFC returns early) | irregexp imported from V8; tables from `make_unicode.py` | ICU4C plus ICU4X (line breaking since Firefox 118; Temporal via temporal_rs; segmenter work ongoing) | own generator plus ICU plus ICU4X | two-stage tables |
| **QuickJS(-ng)** | `libunicode`: `unicode_gen.c` reads 12 UCD files and emits typed runs (code 17 bits, length 7, type 4) found by binary search | own (`unicode_normalize`, compressed decompositions chosen by dynamic programming) | own `cr_*` range sets from the same tables | none | own generator, 17.0 in quickjs-ng | run-length plus binary search |
| **Hermes** | delegated per platform: ICU (`u_strToUpper`), Java (Android), CoreFoundation (Apple), Emscripten; the "Lite" build has **no** case conversion (`FIXME`) | delegated; Lite: none | own | delegated (Android ICU, Apple Foundation) | the platform's | — |
| **Boa** (Rust) | ICU4X `icu_casemap` | ICU4X `icu_normalizer` | ICU4X properties plus its own regex crate | ICU4X (collator, segmenter, datetime) with `boa_icu_provider` (CLDR "modern" locales) | ICU4X compiled data | ICU4X CodePointTrie |
| **Rust `core`** | `char::to_lowercase` via a generated 2-level lookup over ranges plus binary search; ASCII fast path; Final_Sigma in `str::to_lowercase` | not in std | — | — | `unicode-table-generator`, **17.0** in 1.99 | per property the smaller of a **bitset** (deduplicated chunks) or a **skiplist** (short offset runs). **Computed by its generator**: to_lower 1,112 B, to_upper 1,998 B, all core tables 11,508 B |
| **Go** | `unicode.ToLower`: `CaseRanges` (336 entries, deltas plus upper/lower alternation), binary search beyond Latin-1; no special casing in `strings.ToUpper` | `x/text` (outside std) | `regexp` uses `unicode` RangeTables | `x/text` | `maketables`, **17.0** in go1.27.3 | range tables with stride |
| **Java** | `Character`/`String`: tables generated at JDK build (`CharacterData*`); special casing and Final_Sigma in `ConditionalSpecialCasing` | `java.text.Normalizer` (ICU-derived) | `java.util.regex` | `java.text`, `java.time`; ICU4J separate | **per JDK**: 21 → 15.0, 24 → 16.0, 17.0 plus ICU4J 78.1 merged November 2025 | multi-level arrays |
| **.NET** | ICU on Unix and on Windows 10 1903+ (NLS before); invariant mode uses own tables | ICU | own | ICU / NLS | ICU plus own | — |
| **Swift** | native in the stdlib | native (stdlib dropped ICU) | `_StringProcessing` | Foundation (still ICU) | own UCD-derived data | own tables |
| **ICU4C 78.3** | `ucase` trie plus exceptions | Normalizer2 tries | UnicodeSet | everything CLDR | Unicode 17 / CLDR 48 | UCPTrie "fast" (10:6 BMP split) and "small" types |
| **ICU4X 2.4.0** | `icu_casemap` | `icu_normalizer` | `icu_properties` | collator, segmenter, datetime, decimal, plurals, list; C, C++, JS and Dart via Diplomat; `no_std` builds | **Unicode 18 / CLDR 49** (2.3.0: Unicode 17 / CLDR 48.2.1) | CodePointTrie, inversion lists, "compiled data" baked into the binary |

### 3.2 What the table says

- **Every fast engine special-cases ASCII and Latin-1 outside any table** (V8, JSC, Rust, Go, QuickJS). Tables matter only past Latin-1. The ASCII path decides `case-convert`, which is why the row cannot choose a data source.
- **Returning the receiver when nothing changes is standard**: JSC always, V8 for short one-byte strings. nts allocates every time. In real code most `toLowerCase` calls are header names that are already lowercase: `runtime/node` has 59 `toLowerCase` sites and `web-platform` has 83.
- **`normalize` is V8's weak spot.** It copies to UTF-16 before checking even a Latin-1 string. JSC and SpiderMonkey return immediately, because every Latin-1 string is already NFC (**computed**: no Latin-1 code point has `NFC_QC` No or Maybe).
- **Engines that own their RegExp tables generate them from UCD files** (Yarr, SpiderMonkey, QuickJS). V8 uses ICU's sets but needs a generated correction table to match the specification.
- **Locale data is always ICU or ICU4X.** No engine writes its own collation or date formatting.
- **ICU4X adoption is real but partial.** Firefox uses it for `normalize` (Firefox 150) and line breaking, and V8 and SpiderMonkey use it for Temporal. Neither moved DateTimeFormat or NumberFormat off ICU4C, and the ECMA-402 surfaces there are where ICU4C and ICU4X differ.

### 3.3 Table techniques, and which nts should use

| technique | lookup cost | size | use in nts |
|---|---|---|---|
| ASCII/Latin-1 arithmetic and SIMD (e.g. Lemire: 4–34 GB/s with AVX-512 against 0.9–1.3 GB/s scalar, 18–970-byte strings) | branch-free, about 32 bytes per instruction with AVX2 | 0 | **every hot path**; AVX2 is the default CPU level (decision A) |
| Two-stage table (Unicode Standard §5.1), "fast trie" for the BMP (10:6) | 2 dependent loads | moderate | hot per-character tables (lower, upper, simple fold, normalization data) |
| Three-stage compact trie (UCPTrie "small"-like) | 3 dependent loads | ~half of fast | cold tables, supplementary planes |
| Sorted ranges plus binary search (Go, QuickJS, Rust conversions) | ~8 dependent, unpredictable steps | smallest | cold context checks (Final_Sigma's Cased/Case_Ignorable), sets |
| Inversion lists (ICU UnicodeSet, ICU4X) | binary search | small | RegExp sets for dynamic patterns; the compiler's set algebra |
| Bitset/skiplist (Rust) | 1–2 loads / short scan | very small | candidate for big sets in generated RegExp matchers |

---

## 4. The proposed design

### 4.1 Shape

```text
 UCD files, pinned to the oracle's version     third_party/unicode/17.0.0/  (manifest + sha256, vendoring scheme)
              │  parsed once, at cargo build time
              ▼
 compiler/unicode  (crate nts-unicode)        model: properties as inversion lists, mappings, decompositions,
              │                                break properties, IDNA; table builders; per-backend emitters
              ├── compile time: RegExp sets (literal patterns), case closures, constant folding
              │
              ▼  per program: only the services it reaches
 nts_unicode_data.c (C/LLVM) · nts/rt/UnicodeData (JVM) · data segments (standalone Wasm) · nothing (JS-hosted Wasm)
              │
              ▼
 runtime algorithms: runtime/c/nts_unicode.c (native, SIMD fast paths) · TS reference (JVM, standalone Wasm, oracle)
              │
              ▼
 toLowerCase · toUpperCase · toLocale*Case · normalize · RegExp · Segmenter(grapheme) · util width · URL IDNA

 ICU4C 78.3, separately, for CLDR only: Collator/localeCompare, word/sentence Segmenter, Intl formatters
```

### 4.2 Where the data lives

- **Source**:
  - the UCD files of the pinned version, fetched by the vendoring scheme the user approved (`third_party/vendored.json`: URL, sha256 and Unicode License V3; fetched by bootstrap; never at program build time);
  - the needed set is listed in §8: data files plus test files;
  - the 17.0 data files I fetched for this study total about 7.5 MB of text.
- **In the compiler**:
  - `compiler/unicode/build.rs` parses them once into a compact model;
  - the model is embedded in the `nts` binary with `include_bytes!`, an **estimated** 100–400 KB;
  - so a shipped `nts` needs no files and no network (decision 6).
- **Why Rust, and why not checked-in tables**:
  - The compiler itself must answer Unicode questions while compiling: RegExp literal sets (decision 5, matchers generated at compile time), case-equivalence classes for `/x/i`, constant folding of `"Content-Type".toLowerCase()`.
  - A TS generator that writes Rust, or C tables kept in `runtime/c`, would be a second implementation of the same parsing. This generator is part of the compiler's build, not tooling, so the "tooling in TypeScript" rule does not apply. The fetch-and-verify tool is TypeScript, as in the vendoring scheme.
- **Retirements**: `runtime/ecmascript/tools/{generate-unicode.ts, unicode-export.c}`, `src/regexp/unicode-data.ts` and `runtime/c/quickjs/` all go. So does the lesson in `docs/agents/lessons/backends.md`:15, "use the vendored QuickJS libunicode and libregexp", which the 10-22 direction has overtaken.

### 4.3 Tables and layouts

One builder library, several layouts, chosen per table by how hot it is:

| table | used by | layout | bytes (**computed**, Unicode 17) |
|---|---|---|---|
| lowercase (delta plus exception flag) | `toLowerCase` | fast: BMP 10:6 plus supplementary 3-stage | 7,674 (compact 3-stage: 3,610) |
| uppercase | `toUpperCase` | same | 8,154 (compact: 3,930) |
| simple case fold | RegExp `u`/`v` `i`, dynamic patterns and backreferences | same | 7,802 (compact: 3,482) |
| Cased and Case_Ignorable | Final_Sigma context, read only after a `Σ` | range lists (cold) | about 2–3 KB (**estimated** from Rust's skiplist sizes: Case_Ignorable 1,063 B; Lowercase plus Uppercase plus Lt 1,775 B) |
| special casing exceptions | `ß`→`SS` and 102 more | sorted array | 103 entries |
| normalization: combining class, quick-check, decomposition index | `normalize` | fast trie with 32-bit values | trie about 12–25 KB plus decompositions 3,665 UTF-16 units canonical and 5,738 compatibility, plus 961 composition pairs |
| grapheme: GCB, Extended_Pictographic, InCB | Segmenter (grapheme), util width | fast or compact trie | 12,992 fast / 10,352 compact |
| RegExp property database | **dynamic** `u`/`v` patterns only | inversion lists, delta-varint | about 17,300 ranges, about 55 KB (**estimated**; raw u32 pairs 138 KB) |
| East_Asian_Width | util width | range list | 1,201 ranges |
| UTS #46 mapping | URL hosts | ranges plus mapping data | 9,262 rows, 6,124 mapped |

Facts the generator checks, and the algorithms rely on (**computed** from UCD 17.0):

- No simple case mapping crosses between the BMP and the supplementary planes, so UTF-16 length changes only through special casing.
- `toLowerCase` changes length only for U+0130 (`İ` → `i̇`).
- `toUpperCase` grows at 102 code points, by at most 3 units each.
- In Latin-1, only U+00B5, U+00DF and U+00FF uppercase out of one byte.
- Every Latin-1 string is NFC. 53 Latin-1 characters change under NFD and 14 under NFKC.

These become generator assertions, so a Unicode upgrade that breaks one fails the build instead of silently breaking a fast path.

### 4.4 How a program gets only what it uses

- **Catalog**: the crate keeps a catalog `service → tables` and `runtime helper → services`. Lowering already maps JS methods to helpers (`lower.rs`: `toLowerCase` → `nts_str_to_lower_case`).
- **Selection**: today's boolean `uses_unicode` becomes `unicode_services(program)`, the set reached by calls in the prepared HIR. Some services are chosen by constant arguments:

  | call | services emitted |
  |---|---|
  | `s.normalize("NFKC")` | compatibility data only |
  | `s.normalize(form)`, form unknown | all four forms |
  | `new RegExp(x, "g")` | no `u`/`v`, so no property database; no `i`, so no fold table |
  | `new RegExp(x, flags)`, flags unknown | full RegExp data |
  | RegExp literals | sets compiled into the matcher, no runtime tables |

- **Output**: one generated file per backend form. The C file is deterministic for a given table set, so the object cache compiles each distinct set once.
- **Inspection**: `nts providers --sizes` (the builtins study's proposal) lists each table and its bytes.

### 4.5 The API

**C runtime** (`runtime/c/nts_unicode.h`). Each new helper owes the usual four table rows plus a Wasm catalog row, so the list stays short:

```c
NtsString *nts_str_to_lower_case(const NtsString *s);   /* exists; reimplemented */
NtsString *nts_str_to_upper_case(const NtsString *s);   /* exists; reimplemented */
NtsString *nts_str_to_locale_case(const NtsString *s, uint32_t tailoring, bool upper); /* root, tr/az, lt, el */
NtsString *nts_str_normalize(const NtsString *s, uint32_t form);                      /* NFC NFD NFKC NFKD */
uint32_t   nts_ucd_simple_fold(uint32_t cp);           /* RegExp u/v Canonicalize */
uint32_t   nts_ucd_canonicalize_legacy(uint32_t cp);   /* RegExp non-u Canonicalize */
const uint32_t *nts_ucd_property_ranges(uint32_t id, uint32_t *count); /* dynamic \p{} */
uint32_t   nts_ucd_grapheme_next(const NtsString *s, uint32_t from);
uint32_t   nts_ucd_east_asian_width(uint32_t cp);
```

**TypeScript runtime code**: the RegExp interpreter, Segmenter, URL, util. It reaches the same operations through `@ntsAbi intrinsic` declarations. The mechanism exists on `main` (`compiler/core/src/hir/features.rs`): each backend folds `typeof nts_x === "function"`, so native calls the C helper and other targets run the TS body. Table access is one new intrinsic, `nts_unicode_table(id)`, which each backend materializes as constant data (compiler-lane work: a constant-table operation).

**Compiler** (Rust): `nts_unicode::{VERSION, Set, binary_property, general_category, script, script_extensions, string_property, simple_fold_closure, canonicalize, full_lower, full_upper, Tables::emit(selection, backend)}`.

### 4.6 Algorithms and fast paths (native)

**`toLowerCase`** keeps one-byte strings one-byte:

1. One AVX2 pass converts ASCII and records two facts: whether anything changed and whether any byte is above 0x7F. If nothing changed, return the receiver with no allocation.
2. Latin-1 uses the 256-byte table.

**`toLowerCase`** on two-byte strings: a single pass with one allocation of `length + count(U+0130)`.

- **Per unit**: ASCII by arithmetic; BMP by 2 loads; a surrogate pair by the supplementary stage.
- **On `Σ`**: a backward and forward scan of Cased and Case_Ignorable. This is the cold path.
- **Output width**: narrow to one byte if the result fits.
- **CJK and other text without case** skips allocation when no code unit changed.

**`toUpperCase`** works the same way: ß, µ and ÿ on Latin-1. On an exception flag (one of the 102 expansions), a slow path computes the exact length.

**`normalize`**:

- A one-byte string returns itself for NFC, so it is O(1) with no scan; JSC and Firefox do the same, V8 copies.
- An ASCII string returns itself for every form.
- Otherwise a quick-check scan finds the first unit that may change. The prefix is kept, and only the rest is decomposed, reordered and recomposed (UAX #15, Hangul by arithmetic).

**Locale case**:

- `tr`/`az` and `lt` follow SpecialCasing's language rules.
- `el` is ICU's Greek uppercasing (drop tonos and diacritics, keep the dialytika rules). Its data is derived from UCD decompositions and verified against node over every Greek code point and context.
- Every other language, `hy` included, maps to root, exactly as V8 does.

**Grapheme**: UAX #29 with GB9c (InCB). Unicode 18 revises GB9c, so the code is pinned and tested together with its data.

### 4.7 The other backends (one paragraph each)

**JVM.** Use the same compiler tables, emitted as a generated class of `static final` arrays (chunked under the 64 KB constant limit, as `unicode-data.ts` already does). Run the TS reference algorithm compiled to bytecode, or a Java port if a row says so.

The JDK stays only where it is provably identical: Latin-1 strings' `toLowerCase`/`toUpperCase` (`StringLatin1`), since no Latin-1 mapping differs between the Unicode versions involved. JDK 21 is Unicode 15.0 and mis-handles one Final_Sigma context (both **measured**). Unicode results must not depend on which JDK a user runs. Intl stays ICU4J 78.3, the lane's existing provider and node's ICU version.

**Wasm, JS-hosted (browser, node).** Use the host's `String.prototype` methods, `Intl` and RegExp (decision 3): zero bytes. Results follow the host's ICU, so they are exact under node and follow the browser elsewhere; a host-provider warning (the builtins study's NTS1103) says so. RegExp literals may still use compile-time matchers where a benchmark row shows they beat the host's; `\p` sets then come from the compiler as on native.

**Wasm, standalone/WASI.** There is no host, so use the same compiler tables as passive data segments, read into GC arrays or a bounded linear-memory region (both allowed by `docs/wasm.md`). The algorithms come from the TS reference compiled to Wasm, the same code the JVM uses. Intl is not provided at first: it fails with "not on this target" (NTS1100). If a product needs it, ICU4X compiled to Wasm is the natural candidate, not ICU4C.

### 4.8 Versioning, and following node

1. **One pin**: the UCD version in the manifest. It must equal `process.versions.unicode` of the node in `.tool-versions` (24.20.0 → 17.0). A check fails whenever they differ, and its message names both versions. It is a failing check, not a skipped one, because a skipped test reports ok (lesson).
2. **Upgrading.** When `.tool-versions` moves to a node with ICU 79, the same landing:
   - moves the UCD pin to 18.0 and regenerates;
   - reviews the UAX changes (18.0: GB9c revised, InCB derived from Script_Extensions, a line-break rule change);
   - re-runs the three test layers;
   - moves the test262 pin to the property-escape tests generated for 18.0;
   - moves the ICU4C pin to 79.x.
3. **`nts version`** prints the Unicode version; generated files carry it in a header; nts's `process.versions.unicode` (runtime/node) should report it.

### 4.9 Testing against node

| layer | what | runs where |
|---|---|---|
| Data | per-code-point comparison of the crate's model with the pinned node: simple and full mappings, folds, every RegExp property's membership via `new RegExp("\\p{…}", "u")`, all four normalization forms of each code point. Optionally ICU4X 2.3.x (Unicode 17) as a dev-dependency second oracle | `cargo test -p nts-unicode` with `NTS_NODE` set |
| Algorithms, per backend | `tests/programs` fixtures compared with node on C, LLVM, JVM and Wasm: an exhaustive case fixture (a hash per 256-code-point block, details on mismatch), Final_Sigma contexts, the four locale tailorings, normalization of every code point, grapheme sequences. A conformance runner feeds Unicode's own files: NormalizationTest (20,034 lines), GraphemeBreakTest (766; the ICU providers already pass all 766), WordBreakTest (1,944, ICU stage), IdnaTestV2 (6,362) | gate (`agree`), conformance runner |
| Specification | test262 records the gate already checks: String case (30 + 26 files), `normalize` (14), `toLocale*Case` (28 + 26), RegExp property escapes (613 files, 442 in `generated/` for 17.0.0), `unicodeSets` (114), intl402 (later) | `test262_builtins_cases` |

Each defect fixture comes with its one-difference control, per AGENTS.md:

- Final_Sigma: `"ΑΣ"` against `"ΑΣΑ"`.
- New letters: `Ɤ` against `À`, which runs on the JVM lane.
- Armenian: `toLocaleUpperCase("hy")` against `toLocaleUpperCase("en")`, for the Intl provider.

### 4.10 What ICU still does, and how

- **Version**: ICU4C **78.3**, node's version and the provider's existing pin. It is built from vendored source by the C++ toolchain nts already drives.
- **What it serves**: CLDR services only.
- **Data**: each program takes only the items its declared locales and services need (§5.1 has the sizes), assembled by nts itself from the pinned data blob. The `.dat` format is a table of contents of named items; this study parsed it in 30 lines.
- **Speed fixes** (inventory-intl §4.7): service caches for default options, Latin-1 widening on the stack in the Collator, and V8's ASCII L1/L3 fast compare. The L1/L3 weights can come from ICU's root collation at nts build time.
- **The cost**: ICU4C needs a C++ standard library, statically linked from vendored source (zig ships libc++ source), only into programs that reach Intl. That is a product decision (§7, D3).

---

## 5. Costs

### 5.1 Size per program

| what | today | proposed | evidence |
|---|---|---|---|
| hello world, no Unicode | 15,976 B (with `--gc-sections`) | unchanged | **measured** (README) |
| case conversion (lower and upper) | +10,120 B over that | tables 7.5 KB compact to 15.8 KB fast, plus 2–3 KB context, plus about 2 KB code: about **+12 to +21 KB** | today **measured**; proposed **computed** tables plus **estimated** code |
| `normalize` NFC/NFD | n/a (refused) | **estimated** 25–45 KB | **computed** inputs; libunicode packs the same in 15.6 KB (slow); ICU4X 2.3.0 uses about 42 KB (NFD 34,832 B + 2,129 B + NFC 5,308 B, **computed**) |
| `normalize` NFKC/NFKD | n/a | **estimated** +20–60 KB more | ICU4X 2.3.0: +57 KB (**computed**); ICU4C `nfkc.nrm` 56,128 B (**measured**) |
| grapheme Segmenter | n/a | 10–13 KB | **computed**; ICU4X 10–12 KB, ICU4C `char.brk` 14,048 B |
| RegExp literals | n/a | only the sets used, in the matcher | — |
| RegExp, dynamic `u`/`v` | 191 KB of TS source would go to every regexp program | about 55 KB, only when reached | **estimated** |
| URL hosts (UTS #46) | approximation | **estimated** 40–60 KB | ICU4X `uts46` 56,472 B; ICU4C `uts46.nrm` 60,896 B |
| Intl (ICU4C), `en` only | n/a | **estimated** 2.5–3.5 MB, plus about 3 MB of dictionaries if word segmentation of CJK or Thai is reached | **computed** from the 78.3 item sizes: full data 33,107,232 B in 4,305 items (other locales 18.5 MB; converters 5.2 MB, unused; dictionaries 3.0 MB; collation root 597 KB) |
| `nts` binary | — | **estimated** +100–400 KB for the UCD model | — |

### 5.2 Compile time

- **Today**: the libunicode translation unit compiles in 0.25 s (**measured**, README), compiled per program that converts case.
- **Proposed**:
  - the algorithm translation unit is about 1,500 lines of C, compiled once per toolchain and flags by the object cache;
  - the generated data file is const arrays, an **estimated** 10–50 ms in clang and cached by content;
  - in the compiler, emitting tables from precomputed layouts is linear and **estimated** at a few milliseconds; RegExp set algebra is microseconds per set.
- **The guard**: the per-module compile-time tripwire sees nothing super-linear.
- **cargo**: parsing about 7.5 MB of UCD text once in `build.rs` is an **estimated** 0.1–0.3 s, then cached.

### 5.3 Run time

**`case-convert` (measured).** The full run at `833fa3016`, 2026-10-15, timed one case at a time on pinned cores with the benchmark lock held:

| column | time | ratio |
|---|---|---|
| nts LLVM | 3.90 µs | — |
| nts C | 3.90 µs | — |
| node (V8) | 3.13 µs | nts/V8 **1.25x, a loss** |
| Bun | 3.73 µs | nts/Bun **1.05x, a loss** |
| C++ | 6.12 µs | nts/C++ 0.64x |
| nts JVM / Java | 3.28 / 3.40 µs | 0.96x |
| nts Wasm | 4.01 µs | 1.28x against V8 |

- **History**: record 0045 measured 2.49/2.54 µs (0.85x node) after aligning one function, and record 0033 measured 4.80 µs (1.59x).
- **The gap is unexplained**: 3.90 µs is 50% above record 0045, on the same row. It may be a regression or machine conditions; it needs a re-measure on CPU 4 under `with-lock.sh`, which this study could not do.
- **Per conversion**: 30.5 ns against node's 24.5 ns; record 0033 isolated 8.0 ns of that as allocate plus free.
- **Levers**, none of which needs a table: one fused AVX2 pass instead of an OR-scan followed by a conversion pass; no `nts_build_tables` check per call (tables become `static const`); the string header's ASCII flag (strings design §4); and reusing the receiver's storage when it is uniquely owned and dying (record 0033's own proposal).
- **Target** (**estimated**): at most 15 ns per conversion, about 0.6x node.

**Rows that do touch tables.** All **estimated**; they must be added before any data-source choice:

| row | nts today | after stage 1 | why |
|---|---|---|---|
| `case-convert-greek` (two-byte, with final sigmas) | probably several times slower than node: binary search over 378 runs per character, two passes, a temporary `malloc` | 0.3–0.6x node | 2 loads per character, one pass; V8 makes a runtime call plus an ICU preflight |
| `case-convert-cjk` (no case) | slow, as above | ≤ 0.3x node | no allocation; V8 and JSC still call ICU and allocate |
| `case-convert-unchanged` (lowercase ASCII headers) | allocates | ≤ 0.3x node for long strings | returns the receiver; V8 does so only up to 24 characters |
| `normalize-nfc-latin1` | refused | far ahead of node; about level with Bun | O(1) |

---

## 6. Staged plan

Each stage lands through the gate with its rows measured against node and Bun on four backends, its fixtures with controls, and its test262 records. Owners: compiler lane (`compiler/`, `runtime/c`, `runtime/ecmascript`); JVM and Wasm lanes for their backend paragraph.

| stage | work | benchmark rows (against node and Bun) | tests |
|---|---|---|---|
| **0. Instruments** | add rows and fixtures only; the pin check | `case-convert-latin1`, `-greek`, `-cjk`, `-unchanged` (ref.cpp with ICU4C `u_strToLower` once the harness links the pinned ICU; ref.java `toLowerCase(Locale.ROOT)`) | fixtures: Final_Sigma (with control), new letters (JVM), exhaustive per-code-point case; each run against the previous compiler to show it fails before the fix |
| **1. Case mapping** | `compiler/unicode` with UCD 17.0; C table emitter; rewritten `nts_unicode.c` (fused SIMD ASCII pass, Latin-1, one-pass BMP and supplementary, Final_Sigma, receiver return); libunicode no longer emitted; JVM tables for non-Latin-1. Optional A/B, honouring "whichever measures faster": the same C algorithm over an ICU4X 2.3 CodePointTrie exported at build time against the own layout, on `-greek` | `case-convert` (beat 3.13 µs node and 3.73 µs Bun), the four rows above | test262 String case on C, LLVM and JVM (the 3 recorded failures pass); exhaustive differential; `tests/programs/strings` and `case-ascii-widths`; the memory ratchet for `case-convert` stays 17/18 |
| **2. RegExp data** | sets in the compiler for literal patterns (with the Rust RegExp front end the RegExp inventory recommends); runtime tables for dynamic patterns through intrinsics; delete `unicode-data.ts`, `unicode-export.c`, `generate-unicode.ts` | `regexp-unicode-property` (`/\p{L}+/gu`), `regexp-ignorecase-unicode`, `regexp-dynamic-unicode` | RegExp property-escapes (613), `unicodeSets` (114), case-folding tests, Annex B; the TS interpreter as oracle |
| **3. Normalization and IDNA** (QuickJS leaves `runtime/c`) | `normalize` with quick-check and the Latin-1/ASCII identity; full UTS #46 for URL hosts in place of the NFKC approximation | `normalize-nfc-ascii`, `-nfc-latin1`, `-nfc-greek` (already NFC), `-nfd-mixed`, `-nfkc-mixed`, `url-idna` | NormalizationTest (20,034 lines) on each backend; test262 `normalize`; IdnaTestV2 (6,362); WPT URL toascii; exhaustive four-form differential |
| **4. Locale case, grapheme, widths** (still no ICU) | `toLocale*Case` for `az`/`tr`, `lt`, `el` (V8's list exactly); grapheme Segmenter; node `util` widths from East_Asian_Width | `locale-case-tr`, `segmenter-grapheme` (emoji ZWJ and Indic text) | test262 `toLocale*Case` (54) plus intl402 String (19); GraphemeBreakTest (766); exhaustive `el`/`tr`/`lt` differential |
| **5. ICU for CLDR** | vendored ICU4C 78.3; per-program data subset; default-service caches; Collator ASCII L1/L3 fast path and Latin-1 stack widening; drop `hy` from the case-locale list | `intl-collator-sort-ascii`, `-latin1`, `intl-locale-compare`, `intl-number-decimal`, `intl-datetime-format`, `segmenter-word` (inventory-intl §6) | intl402 (3,357 host rows → compiled), `localeCompare`, WordBreakTest and SentenceBreakTest |
| **6. Unicode 18** | when `.tool-versions` moves to a node with ICU 79: UCD 18.0, ICU 79.x, test262 pin, all in one landing | all rows above, compared with the previous run | all three layers |

---

## 7. Decisions the user must make

Product level only; implementation choices are made in §4.

| # | decision | options | recommendation |
|---|---|---|---|
| D1 | Who owns Unicode data | (a) own generator from the UCD, in the compiler; (b) ICU4X data and code; (c) keep libunicode until RegExp | **(a)**. Exact to node's version, smallest per-program cost, one source for four backends. ICU4X serves as a test oracle. If the 10-22 criterion "whichever measures faster" is to stand, the stage-1 A/B settles it on `case-convert-greek`, the row that can tell |
| D2 | Which Unicode version | (a) node's version, moved in lockstep with `.tool-versions`; (b) always the latest | **(a)**. Node is the oracle. Unicode 18 is out but node 24.20 is on 17; (b) would make every new character a differential failure |
| D3 | Intl's locale engine on native | (a) ICU4C 78.3 from source, the same as node, with a static C++ standard library in Intl programs only (an exception to the 10-22 decision "C++ in a vendored corner, with no C++ standard library linked"); (b) ICU4X (no C++, smaller, but not node-identical for DateTimeFormat and NumberFormat, and needs prebuilt Rust libraries per target in `nts`) | **(a)**. Byte-identical answers are the bar, and only Intl programs pay |
| D4 | JVM Unicode data | (a) nts tables, pinned to node's version; (b) the JDK's | **(a)**. A user on JDK 21 otherwise gets Unicode 15 answers (**measured**) |
| D5 | Word-break dictionaries (CJK, Thai, Lao, Khmer, Burmese; 3.0 MB) | (a) only when a program declares those locales; (b) always with Intl; (c) never | **(a)**, as part of "locale subsets by default" |
| D6 | Intl on standalone Wasm | (a) not provided for now (NTS1100); (b) ICU4X compiled to Wasm | **(a)**. The UCD services still work there from the shared tables |

---

## 8. Sources

### This repository (read; nothing edited)

- **Runtime and vendored code**:
  - `runtime/c/nts_unicode.{c,h}`;
  - `runtime/c/quickjs/{README.md, REVISION, libunicode.{c,h}, libunicode-table.h}`;
  - `runtime/jvm/src/nts/rt/NtsRuntime.java:1094`.
- **Compiler**:
  - `compiler/codegen/c/src/emit.rs` (216–240, 520–610, 1025–1045, 1542–1560);
  - `tooling/cli/src/main.rs` (3768–3776, 4977–4995, 9339–9360);
  - `compiler/core/src/hir/lower.rs` (78900–79060);
  - `compiler/core/src/hir/features.rs`;
  - `compiler/codegen/wasm/src/{glue.rs:106, support.rs}`.
- **ECMAScript runtime**:
  - `runtime/ecmascript/{README.md, DATE-TEMPORAL-INTL.md, third_party/README.md}`;
  - `src/regexp/{unicode.ts, sets.ts, unicode-data.ts}`;
  - `src/intl/string-case.ts`;
  - `tools/{generate-unicode.ts, unicode-export.c, build-icu.ts}`;
  - `providers/icu/{versions.json, artifacts.json, dependencies.tsv, c/nts_icu_case.c}`.
- **Web platform and node runtime**: `runtime/web-platform/src/core/{utf8.ts, encoding.ts}`, `runtime/node/url/src/idna.ts`, `runtime/node/util/src/width.ts`.
- **Benchmarks, fixtures and results**:
  - `benchmarks/cases/case-convert/case.ts`;
  - `tests/programs/{strings, case-ascii-widths}`;
  - `results/benchmarks/full.md`;
  - `results/test262/{c,llvm,jvm,wasm}/builtins.tsv`;
  - `tooling/census/test262-evidence-overrides.json`.
- **Docs**: `docs/{architecture.md, primitives.md, wasm.md}`, `docs/records/{0033,0045}`, `docs/agents/lessons/backends.md`, `.tool-versions`.
- **Upstream copies**: `third_party/tsrs/{Cargo.toml, crates/tsrs_scanner/src/unicodeproperties.rs}`, `third_party/test262/test/built-ins/RegExp/property-escapes/generated/*`.

### Prior studies (evidence, not constraints)

`~/.cache/nts-scratch/runtimes/{inventory-intl.md, inventory-regexp.md, audit.md}`; `~/.cache/nts-scratch/primitives/{DECISIONS.md, vendored/report.md}`; `~/.cache/nts-scratch/strings-audit/{design.md, state-of-the-art.md}`; `~/.cache/nts-scratch/builtins/report.md`.

### Probes and analyses of this study

All under `~/.cache/nts-scratch/foundations/unicode/`; data only, no downloaded code was executed.

- **Unicode 17.0 data**: `dl-ucd-17.0.0/`, fetched from `https://www.unicode.org/Public/17.0.0/ucd/` and `/17.0.0/idna/`. Files: UnicodeData, SpecialCasing, CaseFolding, DerivedCoreProperties, PropList, DerivedNormalizationProps, CompositionExclusions, NormalizationTest, Scripts, ScriptExtensions, EastAsianWidth, PropertyValueAliases, GraphemeBreakProperty/Test, WordBreakTest, emoji-data, DerivedGeneralCategory, IdnaMappingTable, IdnaTestV2.
- **ICU4X data crates**: `dl-icu4x-data-2.4.0/` and `dl-icu4x-normalizer-data-2.3.0/`, from static.crates.io.
- **ICU 78.3 data**: `sys-icu-78.3/icudt78l.dat` and `items.tsv`, extracted from the system's `libicudata.so.78.3` for measurement only; nts does not use it.
- **Scripts**: `analysis/{ucd-sizes.ts, ucd-sizes2.ts, cross.ts, baked-bytes.ts, icu-dat.ts, icu-items.ts}`.
- **Probes**: `probes/Probe.java` (JDK 21.0.5), `probes/regexp-version.mjs` (node 24.20.0, Bun 1.4.0), `probes/icu_hy.py` (ICU 78.3 via ctypes).
- **Local toolchain sources**: Rust 1.99 `library/core/src/unicode/unicode_data.rs` (generator size header); Go 1.27.3 `src/unicode/tables.go`.

### External

- **Unicode releases and data**:
  - Unicode 17.0 announcement: <https://blog.unicode.org/2025/09/unicode-170-release-announcement.html>
  - Unicode 18.0: <https://www.unicode.org/versions/Unicode18.0.0/>
  - Unicode 18 release confirmed: <https://gcc.gnu.org/pipermail/libstdc++/2026-September/067801.html>
  - UCD 17.0: <https://www.unicode.org/Public/17.0.0/ucd/>
  - Multistage tables, Unicode Standard ch. 5: <https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-5/>
- **ICU**:
  - releases (79.1 on 2026-10-22, 78.3 on 2026-03-17): <https://icu.unicode.org/>
  - ICU 79 plan: <https://blog.unicode.org/2026/01/unicode-icu-782-and-cldr-481-released.html>
  - UCPTrie design: <https://unicode-org.github.io/icu/design/struct/utrie>
  - properties: <https://unicode-org.github.io/icu/userguide/strings/properties.html>
  - Data Build Tool (27 MiB / 11 MiB gzipped for ICU 64, collation root 511 vs 178 KiB): <https://unicode-org.github.io/icu/userguide/icu_data/buildtool.html>
  - `ucase.cpp` (recognizes `hy`): <https://github.com/unicode-org/icu/blob/main/icu4c/source/common/ucase.cpp>
- **ICU4X**:
  - 2.1 release (CLDR 48; 50–90% smaller than ICU4C; Temporal in V8 and SpiderMonkey via temporal_rs): <https://blog.unicode.org/2025/10/icu4x-21-released.html>
  - repository: <https://github.com/unicode-org/icu4x>
  - `icu_capi` features (no_std, `libc_alloc`): <https://docs.rs/crate/icu_capi/latest/source/Cargo.toml.orig>
  - data crate versions: <https://crates.io/crates/icu_normalizer_data>
  - CLDR 48: <https://blog.unicode.org/2025/10/unicode-cldr-48-available.html>
- **V8**:
  - `intl-objects.cc` (ConvertToLower/Upper, Normalize, StringLocaleCompare): <https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc>
  - `intl-objects.h` (`kCaseMappingSpecialLocales = az, el, lt, tr`): <https://github.com/v8/v8/blob/main/src/objects/intl-objects.h>
  - `builtins-intl-gen.cc` (24-character fast path): <https://github.com/v8/v8/blob/main/src/builtins/builtins-intl-gen.cc>
  - RegExp special-case generator: <https://chromium.googlesource.com/v8/v8/+/refs/tags/8.6.140/src/regexp/special-case.h>, <https://cobalt.googlesource.com/cobalt/+/master%5E/v8/src/regexp/gen-regexp-special-case.cc>
- **JSC**:
  - `StringImpl.cpp`: <https://github.com/WebKit/WebKit/blob/main/Source/WTF/wtf/text/StringImpl.cpp>
  - `StringPrototype.cpp`: <https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/StringPrototype.cpp>
  - Yarr table generator: <https://opensource.apple.com/source/JavaScriptCore/JavaScriptCore-7606.4.5/Scripts/generateYarrUnicodePropertyTables.py.auto.html>, <https://bugs.webkit.org/show_bug.cgi?id=172069>
- **SpiderMonkey and Gecko**:
  - updating Unicode: <https://wiki.mozilla.org/I18n:Updating_Unicode_version>
  - SpecialCasing in `make_unicode.py`: <https://bugzilla.mozilla.org/show_bug.cgi?id=1318403>
  - `normalize` via ICU4X: <https://bugzilla.mozilla.org/show_bug.cgi?id=1932875>
  - ICU4X in Gecko: <https://firefox-source-docs.mozilla.org/intl/icu4x.html>
  - line breaking via ICU4X (Firefox 118): <https://bugzilla.mozilla.org/show_bug.cgi?id=1719535>
  - unified segmenter meta bug: <https://bugzilla.mozilla.org/show_bug.cgi?id=1684927>
- **QuickJS-ng**: <https://github.com/quickjs-ng/quickjs/blob/master/unicode_gen.c>
- **Hermes**:
  - platform implementations: <https://github.com/facebook/hermes/tree/main/lib/Platform/Unicode>
  - Lite (no case conversion): <https://github.com/facebook/hermes/blob/main/lib/Platform/Unicode/PlatformUnicodeLite.cpp>
  - ICU: <https://github.com/facebook/hermes/blob/main/lib/Platform/Unicode/PlatformUnicodeICU.cpp>
- **Boa**: <https://docs.rs/crate/boa_icu_provider/^0.17.0>, <https://code.fanruan.com/github/boa/blame/branch/add-vhs-ci/core/engine/Cargo.toml>
- **Rust**: <https://github.com/rust-lang/rust/tree/master/src/tools/unicode-table-generator> (sizes read from the local 1.99 source)
- **Go**: <https://pkg.go.dev/unicode> (version read from local go1.27.3)
- **Java**:
  - JDK 21 `Character` (Unicode 15.0): <https://cs-214.epfl.ch/jdk-21.0.9-docs/api/java.base/java/lang/Character.html>
  - Unicode 16 in JDK 24: <https://mail.openjdk.org/pipermail/i18n-dev/2024-November/010037.html>
  - Unicode 17 and ICU4J 78.1: <https://mail.openjdk.org/pipermail/i18n-dev/2025-November/012097.html>
- **.NET**: <https://learn.microsoft.com/dotnet/core/extensions/globalization-icu>, <https://github.com/dotnet/corefx/blob/baa9ed4587f0ba2ee60189246f66c24d46c2cfbf/Documentation/architecture/globalization-invariant-mode.md>
- **Swift**: <https://forums.swift.org/t/icu-usage-in-swift/20473>, <https://github.com/swiftlang/swift/pull/40340>
- **Node's ICU**: <https://chromium.googlesource.com/v8/node/+/refs/heads/main/doc/contributing/maintaining-icu.md>
- **Node's URL IDNA (ada)**: <https://github.com/ada-url/idna>
- **SIMD ASCII lowercasing**: <https://lemire.me/blog/2024/08/03/converting-ascii-strings-to-lower-case-at-crazy-speeds-with-avx-512/>
- **test262 property-escape generator**: <https://github.com/mathiasbynens/unicode-property-escapes-tests>

### What I could not verify

- Every run-time figure marked **estimated**: nothing was benchmarked.
- Why `case-convert` measured 3.90 µs at `833fa3016` against 2.49–2.54 µs in record 0045.
- Linked binary sizes of the proposed design: table bytes are **computed** but nothing was linked, and the ICU `en` subset was summed from item sizes, not built.
- The Unicode version of node's ada-url/idna tables.
- Whether Firefox's `Intl.Segmenter` now runs on ICU4X.
- The exact JDK release that carries Unicode 17 (merged into mainline in November 2025, so presumably JDK 26).
- .NET's invariant-mode table details.

---

## Short version

**Recommendation.** Put Unicode's own data (the UCD) into the compiler as a new Rust crate, `compiler/unicode`. It is pinned to exactly the Unicode version of the node in `.tool-versions`: 17.0 for node 24.20.0. The compiler emits only the tables a program uses, as C arrays, JVM constants or Wasm data. RegExp literals get their character sets compiled into the matcher. The runtime keeps small hand-written algorithms with ASCII and Latin-1 SIMD fast paths, and returns the same string when nothing changes. QuickJS's libunicode goes in two steps. ICU4C 78.3 (node's version) stays only for locale data: collation, word breaking and Intl formatting.

**Why.**
- Answers are wrong today:
  - Final_Sigma on C and LLVM: 2 recorded test262 failures;
  - JDK 21 is Unicode 15.0, so `Ɤ` is not lowercased (measured);
  - JDK Final_Sigma: 1 recorded test262 failure;
  - the unbound Intl provider sends `hy` to ICU, which differs from node (measured).
- `case-convert` loses to node (3.90 against 3.13 µs, 1.25x) and Bun (3.73 µs), measured at `833fa3016`. The cause is allocation and per-call cost; the row never reads a table, so it cannot pick a table source. Non-ASCII rows have to come first.
- Size: case tables move from about 10 KB today to 12–21 KB (computed tables). ICU4X data is already Unicode 18, ahead of node; ICU4C is megabytes plus a C++ runtime.
- Unicode 18 (2026-09-16) and ICU 79.1 (2026-10-22) are out; nts moves when its pinned node does.

**The top three decisions for the user.**

- **D1, data ownership**: own generator from the UCD. ICU4X serves as a test oracle, plus an optional stage-1 A/B on `case-convert-greek` to honour "whichever measures faster".
- **D2, version policy**: follow node's Unicode version in lockstep, not the latest.
- **D3, Intl engine**: ICU4C, the same as node. It needs a static C++ standard library in Intl programs only, an exception to the 10-22 rule. The alternative is ICU4X: no C++, but not byte-identical to node.

**Could not verify.**

- Every run-time estimate: nothing was benchmarked.
- Why `case-convert` regressed from 2.5 µs (record 0045) to 3.9 µs.
- Linked sizes of the design, and the ICU `en`-only subset (summed from item sizes, not built).
- The Unicode version of node's URL IDNA library (ada).
- Whether Firefox's `Intl.Segmenter` uses ICU4X.
- The exact JDK release with Unicode 17.
