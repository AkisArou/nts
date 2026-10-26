# Unicode and text data

**Status:** designed and decided 2026-10-27: the user agreed to every
recommendation (D1–D6 below), and amended D5 after an outside review the same
day. The review also corrected the table-selection rules, the
unchanged-string contract and the URL host plan below. Nothing is built yet.

JavaScript needs Unicode knowledge in more places than it looks:
`toLowerCase`/`toUpperCase`, `normalize`, RegExp's `i`, `u` and `v` flags and
`\p{...}`, `localeCompare`, `Intl.Segmenter`, URL host names and terminal
widths. This page says where that knowledge comes from, how each program gets
only the part it uses, and how it stays identical to node.

Terms used below:

- **UCD** (Unicode Character Database): the data files Unicode publishes with
  each version: which characters are letters, their upper- and lowercase forms,
  their decompositions.
- **CLDR**: Unicode's locale data: how German sorts, where Thai words break,
  how a date reads in Greek.
- **ICU**: Unicode's reference library, which node uses. ICU4C is its C/C++
  edition, ICU4X a newer Rust one.
- **Final_Sigma**: a Greek capital sigma lowercases to `ς` at the end of a word
  and to `σ` elsewhere.
- **Normalization**: `normalize()` turns `e` plus a combining accent and the
  single character `é` into one agreed form (NFC, NFD, NFKC or NFKD).

## Where nts stands

Unicode data reaches programs from four places, each with its own Unicode
version: QuickJS's `libunicode` for native case conversion, a 191 KB TypeScript
file generated from that `libunicode` for the RegExp engine, the JDK's tables on
the JVM, and the JavaScript host on Wasm. Most other Unicode features are
refused (`normalize`, `localeCompare`, the locale case forms, `Intl.Segmenter`).

Answers that are wrong today:

| defect | backends | evidence |
|---|---|---|
| Final_Sigma is missing: `"ΑΣ".toLowerCase()` gives `ασ`, node gives `ας` | C, LLVM | two recorded test262 failures (`results/test262/{c,llvm}/builtins.tsv`) |
| JDK 21 carries Unicode 15.0, so a Unicode 16 letter such as `Ɤ` does not lowercase | JVM | probe on JDK 21.0.5 |
| the JDK mishandles Final_Sigma after a supplementary combining mark | JVM | a recorded test262 failure |

The `case-convert` benchmark wins: 1.65 µs on C and 1.64 µs on LLVM, **0.50x
node and 0.48x Bun**. That was measured 2026-10-27 on CPU 4 under `with-lock`,
in five paired rounds, with shipping flags, against node's 3.28 µs and Bun's
3.50 µs. The 3.90 µs row in `results/benchmarks/full.md` predates the ASCII
conversion change `b2e2d24b8` and is stale. That row is all ASCII and never
reads a Unicode table, so it cannot choose a table source. Rows with Greek,
CJK and unchanged text (stage 0) do that.

## The design

```text
 UCD files, pinned to node's Unicode version      third_party/unicode/<version>/ (vendored, sha256-checked)
              │  parsed once, when nts itself is built
              ▼
 compiler/unicode (a Rust crate in the compiler)   properties, mappings, decompositions, break rules
              │
              ├── at compile time: RegExp character sets, case closures, folding
              │   "Content-Type".toLowerCase() to a constant
              ▼  per program: only the tables it reaches
 C arrays (C, LLVM) · constant arrays (JVM) · data segments (standalone Wasm) · nothing (JS-hosted Wasm)
              │
              ▼
 small hand-written algorithms in the runtime, with ASCII and Latin-1 fast paths

 ICU4C, separately, for locale (CLDR) services only: collation, word breaking, Intl formatting
```

1. **The compiler owns the Unicode data.** A new crate, `compiler/unicode`,
   parses the UCD files of exactly the version node reports
   (`process.versions.unicode`: 17.0 for the pinned node 24.20.0). The parsed
   model is baked into the `nts` binary, so a shipped `nts` needs no files and
   no network. It is the one source for C, LLVM, the JVM and both Wasm
   profiles.
2. **Each program carries only the tables it reaches,** chosen through a
   dependency graph of features to data. Lowering already maps each
   JavaScript method to a runtime helper; the helpers a program calls are the
   graph's roots, and constant arguments prune it. The graph must be complete,
   because the obvious shortcuts are wrong:
   - A RegExp literal's character sets are compiled into its matcher, but a
     case-insensitive **backreference** still compares text captured at run
     time: `/^(.)\1$/iu.test("KK")` is `true` (K and the Kelvin sign).
     So such a matcher keeps the folding table: simple folding under `u`/`v`,
     the legacy canonicalization otherwise.
   - A dynamic `new RegExp(...)` without `u`, `v` or `i` still parses group
     names with Unicode identifier rules: `new RegExp("(?<π>x)")` is valid.
   - `normalize("NFKC")` needs the canonical data too (decomposition,
     reordering, composition), not only the compatibility mappings.

   The generator encodes these edges, and a fixture per edge holds them.
3. **The runtime keeps small hand-written algorithms:** case mapping (with
   Final_Sigma and the four locale rules V8 applies: `az`/`tr`, `lt`, `el`),
   normalization, grapheme breaking, RegExp folding, East Asian width. A
   TypeScript reference version serves the JVM and standalone Wasm, and it is
   also the readable specification.
4. **Fast paths, native:**
   - `toLowerCase`/`toUpperCase`: one SIMD pass over ASCII that also notes
     whether anything changed and whether any byte is above 0x7F; **an
     unchanged string is returned as is, with no allocation** (most real calls
     lowercase header names that are already lowercase). Latin-1 by a 256-byte
     table; two-byte strings in one pass with two table loads per character.
     Returning the input changes a contract the memory passes rely on: today
     the compiler treats case conversion as always returning a fresh string
     (`regions.rs` lists it as `Helper::Makes`). The new contract is "an owned
     result that may be argument zero": the unchanged path retains the input,
     and the alias and freshness summaries and region eligibility change in
     the same landing. That ties Unicode stage 1 to the memory contracts.
   - `normalize`: a one-byte string is returned as is for NFC (every Latin-1
     string is already NFC), and an ASCII string for every form. V8 copies the
     string even then; JSC and Firefox don't.
   - The generator checks the facts these paths rely on (for example: only
     U+0130 changes length when lowercased; in Latin-1 only µ, ß and ÿ leave
     one byte when uppercased), so a Unicode upgrade that breaks one fails the
     build rather than a program.
5. **ICU stays only for locale services:** collation (`localeCompare`,
   `Intl.Collator`), word and sentence breaking, and the Intl formatters. It is
   ICU4C 78.3, node's own version, built from vendored source, with each
   program's data cut to the locales it declares, except the word-break
   dictionaries, which follow the text (D5). A program that only lowercases
   never pulls in ICU, which is megabytes of data.
6. **QuickJS goes in two steps:** case conversion first, then normalization and
   the RegExp data.

### The other backends

- **The JVM** uses the same compiler tables as constant arrays, so a user on
  JDK 21 does not get Unicode 15 answers. The JDK stays only where it is
  provably identical (Latin-1 case conversion). Intl uses ICU4J 78.3.
- **Wasm, JS-hosted** (browser, node) uses the host's string methods, Intl and
  RegExp: zero bytes. Results then follow the host's ICU: exact under node,
  the browser's elsewhere.
- **Wasm, standalone** uses the same compiler tables as data segments and the
  TypeScript reference algorithms. Intl is not provided at first.

## Staying identical to node

- **One pin:** the UCD version equals the Unicode version of the node in
  `.tool-versions`. A check fails whenever they differ. When the pinned node
  moves (Unicode 18 and ICU 79 are already out), the UCD, ICU and test262 pins
  move in the same landing.
- **Four test layers on every backend:**
  - an exhaustive comparison with node over every code point (mappings, folds,
    property membership, all four normalization forms);
  - **sequences**, since per-code-point tests cannot see context:
    `"ΑΣ".toLowerCase()` is `"ας"`, `"AͅΣ".toLowerCase()` is
    `"aͅς"`, `"İ".toLocaleLowerCase("tr")` is `"i"`,
    `"Í".toLocaleLowerCase("lt")` is `"i̇́"`, and lone
    surrogates are kept;
  - Unicode's own conformance files (NormalizationTest, GraphemeBreakTest,
    IdnaTestV2);
  - test262's records (String case, `normalize`, RegExp property escapes,
    `unicodeSets`).
- **Behaviour before the tables:** what happens before a lookup must match V8
  too. `"I".toLocaleLowerCase({ 0: "tr", length: 1 })` is `"ı"` (an array-like
  locale list). `"I".toLocaleLowerCase(["en", "bad_tag"])` is `"i"` in node:
  V8 reads only the first locale for casing. The Intl wrappers in
  `runtime/ecmascript` (locale-list conversion, coercion and getter order,
  invalid tags, the default locale) are audited against node before they are
  bound.
- **A compatibility manifest** records the exact node build and its V8, ICU,
  CLDR and Unicode versions, and the URL library's data version, which comes
  from ada, not ICU.

## Costs

| | today | with this design |
|---|---|---|
| a program that converts case | +10 KB | +12 to +21 KB (tables computed, code estimated) |
| `normalize` NFC/NFD | refused | about 25–45 KB, estimated |
| grapheme segmentation | refused | 10–13 KB, computed |
| RegExp with dynamic `u`/`v` patterns | 191 KB of TypeScript data | about 55 KB, only when reached, estimated |
| Intl (ICU), English only | refused | about 2.5–3.5 MB, estimated; more for word breaking in CJK or Thai |
| the `nts` binary | | +100–400 KB for the Unicode model, estimated |

Compile time stays negligible: the tables are constant arrays, cached by
content. Run-time numbers are estimates until stage 0's rows exist.

## Build order

Each stage lands through the gate with its benchmark rows against node and Bun
on four backends, its fixtures with controls, and its test262 records.

| stage | work | rows |
|---|---|---|
| 0. Instruments | rows and fixtures only, plus the version pin check | `case-convert-latin1`, `-greek`, `-cjk`, `-unchanged`; Final_Sigma and new-letter fixtures |
| 1. Case mapping | `compiler/unicode`; the C table emitter; rewritten case conversion with its exception records (expansions, context state, lone surrogates); the new "may return argument zero" contract in the memory passes; libunicode no longer emitted; JVM tables | `case-convert` stays ahead of node and Bun; the four new rows |
| 2. RegExp data | character sets compiled for literal patterns; tables for dynamic ones; the 191 KB TypeScript data goes | `\p{L}` matching, case-insensitive Unicode matching, dynamic patterns |
| 3. Normalization and URL hosts | `normalize`; URL hosts by the full UTS #46 processing the WHATWG URL standard specifies (nontransitional, with its bidi, joiner and hyphen settings, and Punycode validation), with the mapping data vendored; QuickJS leaves `runtime/c` | `normalize` on ASCII, Latin-1, Greek and mixed text; URL host conversion. Node rejects `a‍b.com` and `́a.com`, which today's approximation accepts |
| 4. Locale case, graphemes, widths | `toLocale*Case` for `az`/`tr`, `lt`, `el`; grapheme segmentation; terminal widths | locale case, grapheme segmentation |
| 5. ICU for locale services | ICU4C 78.3 with per-program data; collator fast paths | sorting and comparing strings, number and date formatting, word segmentation |
| 6. Unicode 18 | with the next node pin | every row above, against the previous run |

## Decisions (2026-10-27)

The user agreed to each recommendation as written. D5 was amended the same
day, after the outside review showed the first version gave different answers
from node.

| # | question | decision |
|---|---|---|
| D1 | Who owns the Unicode data | **Our own generator from the UCD, in the compiler.** Exact to node's version, the smallest cost per program, one source for four backends. ICU4X becomes a second oracle in the tests. The 10-22 rule "whichever measures faster" is honoured by an A/B on `case-convert-greek` in stage 1. |
| D2 | Which Unicode version | **Node's, moved in lockstep with the pinned node,** not the latest. |
| D3 | Intl's engine on native | **ICU4C, the same as node.** It needs a C++ standard library, linked statically and only into programs that use Intl: an exception to the 10-22 rule "no C++ standard library linked". ICU4X needs no C++ but does not format dates and numbers byte-identically to node. Not needed before stage 5. |
| D4 | The JVM's Unicode data | **nts's tables,** so answers do not depend on which JDK a user runs. |
| D5 | Word-break dictionaries (CJK, Thai, Lao, Khmer, Burmese; 3 MB) | **Whenever a program uses word segmentation, unless its input is proved free of those scripts** (amended). ICU picks a dictionary from the script of the text, not from the requested locale: `new Intl.Segmenter("en", { granularity: "word" })` splits `"ภาษาไทย"` into `"ภาษา"` and `"ไทย"` in node. *Superseded:* "only when a program declares those locales". Locale subsets still apply to everything else. |
| D6 | Intl on standalone Wasm | **Not provided for now.** The Unicode services still work there. |

## Evidence

The study behind this page, with its measurements, computed table sizes and 60
sources, is `~/.cache/nts-scratch/foundations/unicode/report.md` (local, not in
the repository).
