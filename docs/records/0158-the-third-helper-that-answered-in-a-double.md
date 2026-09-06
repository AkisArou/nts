# 0158 — The third helper that answered in a double, and the audit that ends it

Three times now, in three months, the same defect: a growable-array helper whose
only signature answers in a `double`, reached from generated code that wanted an
integer, so the value goes `i2d` inside the helper and `d2i` at the call site.

| | found in | worth |
| --- | --- | ---: |
| the subscript, `get(a, double)` | record 0138 | **4.56x** on `growth-grown` |
| the constructor, `of(double)` | record 0138's neighbour | part of `array-predicates` |
| **the length, `length(a) -> double`** | here | 10 sites on `array-predicates` |

`array.len` is an `i32` upstream since `c3c2010`. The growable wrapper's length
is an `int` field. The only way between them was a helper returning `double`, so
`predicates$whole` emitted `getfield length; i2d; invokestatic; d2i` five times
a specialization for a value that is an `int` at both ends.

`count(a) -> int` beside `length(a) -> double`, and `OpKind::Length` picks by
what the *result* is wanted as rather than by what the helper offers. Ten sites
on that row become `count(...)I`.

## The audit, because a third occurrence is a pattern

Every `NtsArrayD` helper that answers in a `double`, and whether it should:

| | answers | verdict |
| --- | --- | --- |
| `get`, `pop`, `shift`, `unshift`, `at` | the **element** | correct — a `number[]` holds f64 |
| `length` | a count | **was wrong, fixed here** |
| `push` | the new length | an integer in a double, and upstream |
| `indexOf`, `lastIndexOf` | an index | an integer in a double, and upstream |

The last two are not this backend's to fix: `nts_array_push` and
`nts_array_index_of` have their return types in `hir::runtime`, which is the
single answer about conversions and must stay one. `push`'s result is dropped in
every case measured, so it costs nothing today. `indexOf`'s is not — it is the
`d2l; l2i` pair still visible in `array-methods`, four of them, and a diff for
it went upstream this morning.

So the family is closed on this side. There is no remaining helper in
`runtime/jvm` that answers a count or an index in a `double` where the caller
wants an integer and an overload could exist.

## What the three have in common, which is the part worth keeping

None of them was found by a profiler. The subscript came from `javap | grep`,
the constructor from reading the same dump one line further down, and this one
from a bytecode histogram of a row I was looking at for a different reason.
They are invisible to a profile because the conversion is two instructions
attributed to whatever frame they sit in, and they are obvious in a disassembly
because a `double` in a descriptor where an `int` belongs is a spelling
difference a reader notices.

The rule that follows: **when a helper's signature and its caller disagree about
a machine type, the disagreement is in the descriptor and the descriptor is
printed.** Look there before profiling.
