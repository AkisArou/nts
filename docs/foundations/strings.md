# Strings

**Status:** an approved design. Stages 0, A and B are built; the rest is
designed.

## What a string is

On native, a string is a 24-byte header (descriptor, count, flags, length),
then a cached-hash word, then its code units inline: one byte each when every
unit fits in Latin-1, two otherwise. JavaScript indexes UTF-16 code units, so
storage is never UTF-8. The JVM uses `java.lang.String`, which has the same
one-or-two-byte shape. Wasm's representation is decided when Wasm resumes
([wasm.md](../targets/wasm.md)).

## What is built

| stage | what | landed |
|---|---|---|
| 0 | the microbenchmark rows: `str-append-loop`, `str-append-length`, `str-slice-keep`, `str-index-read`, `str-to-number`, `json-quote`, and others | yes |
| A | one fast number formatter (zmij) behind every sink | yes |
| B | a string only appended is built where it is appended (destination passing); helpers append numbers, units and slices without a temporary | yes |
| — | in-place append when the string is uniquely owned; a cached hash; precomputed literal hashes; SIMD JSON quoting | yes |
| C | allocation: now part of [memory](memory.md) | see there |

## Stage D: the header carries what the hot operations ask

**One always-valid data pointer,** as JavaScriptCore has. An ordinary string
points into its own inline storage. A literal points to read-only data, a
slice into its owner, and an adopted or external string into storage someone
else manages. Every kind then shares one access path, and a slice no longer
needs a copy.

- **The cost:** 8 more bytes. The payload moves from offset 28 to 36 with
  careful field order (estimated), and every read gains a dependent load,
  usually hoisted out of loops. Rows decide whether it pays.
- **Slices own their owner:** a slice retains and releases the string it
  points into, never lets that owner be mutated in place, and collapses nested
  owners. A tiny slice of a huge string keeps the huge one alive, which needs
  its own rule and row.
- **Foreign code:** today a string passed to C is borrowed because its units
  are terminated at its length. A slice is not, so conversion at the C
  boundary must know whether storage is terminated. The existing rules for
  embedded NUL and lone surrogates stay.

**Flags that record proved facts:** set means proved, clear means unknown,
each computed only where the data is already being read (no extra pass).

| flag | set when | kept through |
|---|---|---|
| ASCII | a literal, a decode, or a copy that already scans | slices; concatenation of ASCII strings |
| JSON-clean (no control character, quote or backslash) | the copy or classification that already runs | slices and concatenation; skipping escaping also needs well-formed |
| well-formed UTF-16 | every Latin-1 string; validated decodes; literals | concatenation of well-formed strings; a slice only after checking its two ends (`"𐀀".slice(0, 1)` is not well-formed) |
| terminated | how the storage was made | never inherited by a slice |

The flags stay apart from the collector's bits and from the hashed and grown
settlement rule: hashing clears `NTS_GROWN`, so a hashed string is never
appended into.

**No small-string optimization in the value itself.** Payloads are already
inline, and small strings are cached. Characters inside the 16-byte value would
change calling conventions, containers and erased values. Revisit only if an
allocation census shows short escaping strings dominate once allocations are
removed.

## Stage E: fewer passes and fewer temporaries

nts's advantage is not that it can reuse a string's storage: SpiderMonkey and
Hermes reuse growing buffers under a tracing collector too. **The advantage is
removing allocations and passes entirely,** which an ahead-of-time compiler with
types can prove: borrow spans, pass destinations, allocate a known
concatenation once, skip counts on proved borrows, and use frames for bounded
results.

| work | gain | rows |
|---|---|---|
| copy and classify in one pass (escaping, scanning) | one read instead of two per character; not a timing promise | `json-quote`, serialization rows, short and long, both widths, rare and dense escapes |
| `a + b + c` and templates in one exact-size allocation | no intermediate strings | `str-concat-pair`, `str-template`, `str-join`; mixed widths, aliases |
| finish lowering `out += s.slice(a, b)` onto the existing `nts_str_append_slice` | no substring built to be appended | slice-and-append, self-append, overlap, width promotion |
| search kernels (`indexOf`, `includes`): a tiny-input path, a SIMD prefilter, a robust fallback | fewer candidates; predictable worst cases | `str-index-of`, absent needles, repeated prefixes; matches stay unit-aligned |
| `split`: build the result in one pass (today it counts, then scans again) | one pass | split rows; empty separator, limits |
| case conversion returns an unchanged string as is | no allocation | `case-convert` and the Unicode rows ([unicode.md](unicode.md)) |

Order and conversions are kept exactly. A concatenation converts its operands
left to right, as written, so evaluating every operand first would change
getters and exceptions. Growth keeps the old storage alive until the append
has finished reading it.

## What not to do

- **No UTF-8 storage.**
- **No ropes at run time** unless a row proves them. A rope also cannot supply
  stage D's contiguous data pointer, so the first choice is an internal
  segmented builder that materializes an ordinary string when needed. Bun's
  lead on `json-serialize` is thought to come from a rope that is never
  flattened, which is not verified: measure before the representation follows
  it.
- **No `invokedynamic` concatenation on the JVM;** destination passing beats it
  there.

## Evidence

The string microbenchmarks the stages are held to are
[in the records](../records/notebooks/studies/primitives-string-bench.md).
The design follows an inventory of nts's string operations, a
state-of-the-art study and an outside research review, each checked against
the code.

## Decisions

- The string design is approved, in the order this page gives: the
  microbenchmark matrix, the number formatter, destination passing, allocation,
  the header, the escape primitive, Wasm strings, then parse regions. Strings
  are never stored as UTF-8, and there are no run-time ropes unless a row
  proves them ([log](../records/notebooks/decisions-log.md#strings-10-22)).
