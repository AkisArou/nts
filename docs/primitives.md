# The primitives, and what each costs

The audit is "one primitive at a time": representation, then operations, then
memory fit, and a primitive is closed when it has three ratchets — an example
node agrees with, a `tooling/memory` case whose floors were argued before they
were measured, and a benchmark row against C++ and node.

Twenty-five records say how each got there. This is the state they add up to,
in one table, because a closed primitive that takes five records to verify is
not legible.

Ratios are against the LLVM backend, as the README's are. `--` in the C++
column is a row with no hand-written reference; the case says why.

## The table

| primitive | correctness | memory: ops / allocs | speed: vs C++ / node | record |
|---|---|---|---|---|
| **number** | `arith`, `mathops`, `bitwise` | `number-to-string` 0 / 0 | `number-format` 0.82 / 0.49<br>`loop` 0.99 / 0.98<br>`fib` 1.71 / 0.52 | 0030, 0034 |
| **string** | `strings`, `string-methods` | `string-append` 1 / 2<br>`string-build` 1 / 2<br>`case-convert` 18 / 17 | `strings` 0.63 / 0.05<br>`node-utf8` — / 0.93<br>`substrings` 1.88 / 0.48<br>`case-convert` 0.40 / 0.83 | 0029, 0033, 0035 |
| **boolean, null, undefined** | `absent`, `nullish`, `unknown-truthiness` | `boolean-flags` 0 / 0 | `absences` 4.46 / **1.05** | 0031, 0039, 0053 |
| **bigint** | `bigint` | `bigint-arithmetic` 0 / 0 | `bigint` 0.99 / 0.09 | 0036 |
| **symbol** | `symbol-keys` | `symbol-keys` 0 / 0 | `symbol-keys` 1.02 / 0.19 | 0037 |
| **array** | `arrays`, `growable`, `callbacks` | `array-methods` 2 / 6<br>`array-mutations` 5 / 9<br>`array-of-objects` 18 / 22 | `arrays` 1.06 / 0.56<br>`array-methods` 0.54 / 0.22<br>`array-predicates` 1.09 / 0.58<br>`array-mutations` 1.04 / 0.37 | 0038, 0043, 0047, 0048, 0052 |
| **object and class** | `instances`, `classes`, `inheritance` | `subclass-field` 0 / 0<br>`nulled-field` 17 / 17<br>`readonly-anchor` 40 / 2 | `objects` 1.00 / 0.84<br>`dispatch` 0.99 / 0.67 | 0054 |
| **function and closure** | `closures`, `function-values` | `closure-capture` 0 / 0 | `closures` 1.01 / 0.38<br>`dispatch` 0.99 / 0.67 | 0040 |
| **Map and Set** | `map-and-set`, `iteration` | `map-and-set` 2 / 17 | `map-and-set` 0.56 / 0.76 | 0041 |

## What the table says that no single record does

**Two rows lose to node, and only one is news.** `absences` at 1.05x is 0053,
found by this table having a hole in it — the absence primitive had two ratchets
and had never been timed. `awfy-mandelbrot` at 1.02x is not a primitive row; it
matches C++ to four significant figures.

**Six memory cases read zero.** `number-to-string`, `boolean-flags`,
`bigint-arithmetic`, `symbol-keys`, `closure-capture`, `subclass-field`. "Zero,
and here is the case" is the strongest answer a memory ratchet gives, and it is
the answer for a third of the queue.

**Three rows above 1.20x C++ are statements rather than targets**, and 0049 has
the evidence for each: `substrings` 1.88x against a `string_view` that aliases
where we copy, `fib` 1.71x against an `int64_t` that wraps where we cannot, and
`absences` 4.46x against a POD that vectorises where a tagged sixteen-byte value
cannot.

**`object and class` had three ratchets and no record.** It was audited between
array (0038) and closure (0040) and closed without one being written — the
ratchets were real and the argument for its representation existed only in the
code. This table is what made that visible, by giving the record a column and
leaving one cell empty. 0054 fills it, and found one thing in the writing: an
array of references is conservatively cyclic where a lone object of the same
type is not, which is unmeasured.

## The open number

`absences`, 4.46x C++ and 1.05x node. The cause is measured (an integer
round-tripping through the erased value's `double` payload, which blocks the
vectorisation C++ gets) and the fix is named and not yet built: splitting a
union-typed block parameter into a `bool` and a payload, which is the type
layer's "unions that lay out differently" rather than an extension of
`hir::unerase`. 0053 has both, including the first answer, which was wrong.
