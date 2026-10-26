# Unicode and text data

**Status:** designed and decided 2026-10-27: the user agreed to every
recommendation (D1–D6 below). Nothing is built yet.

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

The `case-convert` benchmark loses: 3.90 µs against node's 3.13 µs (1.25x) and
Bun's 3.73 µs (1.05x), in the last full run (`results/benchmarks/full.md`).
That row is all ASCII and never reads a Unicode table; it loses on allocation
and per-call cost. Record 0045 measured it at 2.49 µs, so the gap since then
needs a re-measure.

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
2. **Each program carries only the tables it reaches.** Lowering already maps
   each JavaScript method to a runtime helper; the set of helpers a program
   calls picks the tables. Constant arguments narrow it further:
   `normalize("NFKC")` takes only the compatibility data, and a RegExp without
   `u`, `v` or `i` takes no property or folding data. RegExp literals get their
   character sets compiled into the matcher and need no table at run time.
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
   program's data cut to the locales it declares. A program that only
   lowercases never pulls in ICU, which is megabytes of data.
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
- **Three test layers on every backend:** an exhaustive comparison with node
  over every code point (mappings, folds, property membership, all four
  normalization forms); Unicode's own conformance files (NormalizationTest,
  GraphemeBreakTest, IdnaTestV2); and test262's records (String case,
  `normalize`, RegExp property escapes, `unicodeSets`).

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
| 1. Case mapping | `compiler/unicode`; the C table emitter; rewritten case conversion; libunicode no longer emitted; JVM tables | `case-convert` must beat node and Bun, plus the four new rows |
| 2. RegExp data | character sets compiled for literal patterns; tables for dynamic ones; the 191 KB TypeScript data goes | `\p{L}` matching, case-insensitive Unicode matching, dynamic patterns |
| 3. Normalization and URL hosts | `normalize`; full IDNA host mapping; QuickJS leaves `runtime/c` | `normalize` on ASCII, Latin-1, Greek and mixed text; URL host conversion |
| 4. Locale case, graphemes, widths | `toLocale*Case` for `az`/`tr`, `lt`, `el`; grapheme segmentation; terminal widths | locale case, grapheme segmentation |
| 5. ICU for locale services | ICU4C 78.3 with per-program data; collator fast paths | sorting and comparing strings, number and date formatting, word segmentation |
| 6. Unicode 18 | with the next node pin | every row above, against the previous run |

## Decisions (2026-10-27)

The user agreed to each recommendation as written.

| # | question | decision |
|---|---|---|
| D1 | Who owns the Unicode data | **Our own generator from the UCD, in the compiler.** Exact to node's version, the smallest cost per program, one source for four backends. ICU4X becomes a second oracle in the tests. The 10-22 rule "whichever measures faster" is honoured by an A/B on `case-convert-greek` in stage 1. |
| D2 | Which Unicode version | **Node's, moved in lockstep with the pinned node,** not the latest. |
| D3 | Intl's engine on native | **ICU4C, the same as node.** It needs a C++ standard library, linked statically and only into programs that use Intl: an exception to the 10-22 rule "no C++ standard library linked". ICU4X needs no C++ but does not format dates and numbers byte-identically to node. Not needed before stage 5. |
| D4 | The JVM's Unicode data | **nts's tables,** so answers do not depend on which JDK a user runs. |
| D5 | Word-break dictionaries (CJK, Thai, Lao, Khmer, Burmese; 3 MB) | **Only when a program declares those locales,** as part of "locale subsets by default". |
| D6 | Intl on standalone Wasm | **Not provided for now.** The Unicode services still work there. |

## Evidence

The study behind this page, with its measurements, computed table sizes and 60
sources, is `~/.cache/nts-scratch/foundations/unicode/report.md` (local, not in
the repository).
