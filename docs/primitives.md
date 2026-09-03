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
| **string** | `strings`, `string-methods` | `string-append` 1 / 2<br>`string-build` 1 / 2<br>`case-convert` 18 / 17 | `strings` 0.63 / 0.09<br>`node-utf8` — / 0.93<br>`substrings` 0.93 / 0.23<br>`case-convert` 0.40 / 0.83 | 0029, 0033, 0035, 0059, 0060, 0062 |
| **boolean, null, undefined** | `absent`, `nullish`, `unknown-truthiness` | `boolean-flags` 0 / 0 | `absences` 2.14 / 0.50 | 0031, 0039, 0053, 0057 |
| **bigint** | `bigint` | `bigint-arithmetic` 0 / 0 | `bigint` 0.99 / 0.09 | 0036 |
| **symbol** | `symbol-keys` | `symbol-keys` 0 / 0 | `symbol-keys` 1.02 / 0.19 | 0037 |
| **array** | `arrays`, `growable`, `callbacks` | `array-methods` 2 / 6<br>`array-mutations` 5 / 9<br>`array-of-objects` 18 / 22 | `arrays` 1.06 / 0.56<br>`array-methods` 0.51 / 0.21<br>`array-predicates` 1.09 / 0.58<br>`array-mutations` 1.07 / 0.37 | 0038, 0043, 0047, 0048, 0052 |
| **object and class** | `instances`, `classes`, `inheritance` | `subclass-field` 0 / 0<br>`nulled-field` 17 / 17<br>`readonly-anchor` 40 / 2<br>`cyclic-array` 8 / 4 | `objects` 1.00 / 0.84<br>`dispatch` 0.99 / 0.67 | 0054, 0055, 0056 |
| **function and closure** | `closures`, `function-values` | `closure-capture` 0 / 0 | `closures` 1.01 / 0.38<br>`dispatch` 0.99 / 0.67 | 0040 |
| **Map and Set** | `map-and-set`, `iteration` | `map-and-set` 2 / 8 | `map-and-set` 0.55 / 0.74 | 0041, 0065 |

## What the table says that no single record does

**No primitive row loses to node.** `absences` did, at 1.05x, found by this
table having a hole in it — the absence primitive had two ratchets and had never
been timed. 0057 closed it to 0.50x by splitting the union its block parameter
carried into a tag and a payload. The one row still above node anywhere is
`awfy-mandelbrot` at 1.02x, which is not a primitive row and matches C++ to four
significant figures.

**Six memory cases read zero.** `number-to-string`, `boolean-flags`,
`bigint-arithmetic`, `symbol-keys`, `closure-capture`, `subclass-field`. "Zero,
and here is the case" is the strongest answer a memory ratchet gives, and it is
the answer for a third of the queue.

**Two rows above 1.20x C++ are statements rather than targets**, and 0049 has
the evidence for each: `fib` 1.71x against an `int64_t` that wraps where we
cannot, and `awfy-bounce` 1.56x against an array that holds its elements inline.
`substrings` was the third at 1.88x and is no longer above 1.20x at all: the
evidence for it was wrong twice — we never allocated, and the copy was 58%
rather than the 13% a profile suggested — and 0062 stopped building a substring
that nothing reads as a string, which took the row to 0.93x.
`absences` was the third at 4.46x, and it was not a statement — it was a tagged
value round-tripping an integer through a double, which 0057 removed.

**`object and class` had three ratchets and no record.** It was audited between
array (0038) and closure (0040) and closed without one being written — the
ratchets were real and the argument for its representation existed only in the
code. This table is what made that visible, by giving the record a column and
leaving one cell empty. 0054 fills it, and found one thing in the writing: an
array of references is conservatively cyclic where a lone object of the same
type is not.

**That imprecision was unmeasured, and measuring it found a segfault.** The case
written to price it — `cyclic-array` — crashed instead, because a container the
collector can *buffer* outlives the release that should have ended it, and so
outlives the frame whose objects it holds. 0055 has the diagnosis and two tests
that looked like they refuted it; 0056 has the fix and the price, which is two
heap allocations where the frame used to do. The shipping build never buffers a
candidate here at all, because elision removes the releases that would ask.

## The open number

`absences` was it, and 0057 closed it. What that measurement uncovered is
sharper: on the split shape the **C backend is 188.7ns and the LLVM backend is
399.7ns**, on the same HIR, from the same fifteen passes. Ratios in this table
are the LLVM ones, so more than half of what `absences` still pays against C++
is a backend gap rather than a representation gap — with the frontend held
fixed, which is the easiest kind to chase.

One correction 0057 makes to 0053, which named this fix first: it proposed a
`bool` and a payload, and a `bool` cannot serve `T | null | undefined`, whose
block tests `null` and `undefined` separately. The split carries the *tag*,
which covers both shapes as one.
