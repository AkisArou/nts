# A date is a double, and the borrow that read it cost more than the date

`Date` was the largest single type left in the profile: **55 refusal sites, all
of them one property.** `fs.Stats.atime` and its three siblings, each
`new Date(ms)` over a number the platform supplies.

The feature is small, and the interesting part is not the feature.

## What a Date is, and what it is not

A header and a double. The specification calls the contents a *time value* and
defines every accessor as arithmetic on it, so `ManagedType::Date` carries
nothing — unlike `Promise` and `Map` there is not even a payload representation
to decide. It is a managed type rather than a provided class on the standard
this enum already applies: its C type is a fixed runtime struct, so a layout
would be a shape with a field nothing may read.

`TimeClip` is the whole of what the constructor does, and both halves are
observable: `new Date(1.5).getTime()` is 1, and `new Date(8.64e15 + 1)` is NaN
rather than a large number. A third half was not: **`-0` normalises to `+0`**,
which only `1 / t` can tell, and which node confirms
(`Object.is(new Date(-0).getTime(), -0)` is false).

Three things are refused, for three different reasons, and none of them is "not
implemented":

- **`Date.now()` and `new Date()`** read a wall clock this runtime has no
  capability for — and no differential could check them if it had one, because
  node answers with its instant and this with a later one. The same reason
  `Math.random` is absent.
- **`toISOString`** throws a `RangeError` on an invalid date, and a runtime
  helper here has no way to throw. This is the one worth stating carefully: the
  differential scores node's throw as *a case not reached*, not as a
  disagreement, so answering with a string would be a divergence **the oracle is
  blind to**. Both call sites in `runtime/node` already guard it with
  `Number.isNaN(d.getTime())`, and the guard is on the value.
- **The `getFullYear` family** reads a *local* calendar, which needs a timezone
  database and would make one program answer differently on two machines.

The calendar for `toISOString` was written — Howard Hinnant's `civil_from_days`,
checked against node across leap years, the 1900/2000/2100 rules, year zero and
both era boundaries — and then **removed**, because a tested implementation
nothing can reach is scaffolding. It is sixty lines and it can come back with
the throw.

## The memory case found something much larger

Argued before measuring: seventeen allocations, one per iteration, and seventeen
operations, one release each. The argument is a list of what is *absent* — no
string, because nothing formats the number; no table; no reference field, so a
date is outside the cycle collector for the same reason a string is.

    allocated   17 argued, 17 measured
    operations  17 argued, 51 measured

Three per iteration where one was argued. The two extra were a **retain and a
release around reading `this.atime`** to hand to `nts_date_value` — a helper
that loads a double out of the reference and returns it.

`own::mutating`'s own comment had already named this and said where the fix
belonged:

> An **external** call has no body in this program, so it mutates too. That
> second one is coarser than it needs to be: the runtime already marks its
> read-only helpers `NTS_READS_ONLY`, and `hir::runtime` could carry that
> alongside the types it already carries. Until it does, an external call ends a
> borrow.

So `hir::runtime` carries it. `own::quiet` — "can this operation store, call,
allocate or suspend" — answered `false` for every call, and a helper that reads
through its arguments and returns does none of the four.

    dates   51 operations -> 17, at the floor

**And `nts_date_value` is one of twenty-eight.** The header has marked the rest
for a long time and nothing on this side read it, so every `xs.indexOf`,
`s.startsWith`, `m.has`, `xs.at` and `s.charCodeAt` ended a borrow it had no way
to invalidate. The whole set is carried now, and the memory suite is green at
every floor with it.

That is the second time this week a comment describing an unbuilt fix has been
the most valuable thing in a file — after `copies_of`'s "a class with type
parameters that nothing instantiates is dead", which was describing behaviour
the code did not have.

## Two lists, and the check that found the other twenty-seven

`runtime::READS_ONLY` and the header's `NTS_READS_ONLY` are one fact in two
places, which is the shape that produced the tag tables, `NtsValue.java`, and
the LLVM signature generator reading one header of two. So the check went in
with the list, and it failed immediately:

    the header marks `nts_array_at` NTS_READS_ONLY and runtime::READS_ONLY
    does not list it

That is what turned a one-helper fix into a twenty-eight-helper one. The two
directions are not symmetric and the message says so: a name on our list the
header does not mark keeps a borrow across a call that may store, which is a use
after free no answer would differ over; the other way is a missed elision.

## The macro that broke a header twice

`NTS_ALLOCATES` and `NTS_READS_ONLY` were defined four hundred lines below the
prose that argues for them, and a declaration written above that point does not
fail at the definition — it fails as `unknown type name 'NTS_ALLOCATES'` at the
*use*, which reads like a broken declaration rather than a macro out of order.

That happened once for each macro on the same day, and the first time it broke
the benchmark harness for another session mid-measurement: `nts-bench` builds
every variant for a case and reports the case as failed, so a broken C header
costs the JVM number too. **Both definitions now sit at the top of the header**;
the arguments for them stay where they were.

## No benchmark row, and the reason

A row timing `new Date(ms).getTime()` in a loop would measure an allocation
against a C++ reference that has none — a `struct { double }` by value. That gap
is real and it is **record 0092's**, not a fact about dates: `ObjectNew` carries
a `frame` flag and the runtime's fixed structs do not, so `nts_date_new` reaches
an allocator whatever the caller does with the result. A row would report that
as the cost of `Date`.

The measurement worth having is the one 0092 already names, on a case built for
it. This one would only restate it under a misleading name.

## Ratchets

- `examples/dates` — 174 cases against node on C and LLVM: round trip,
  `valueOf` agreeing with `getTime`, truncation toward zero, the range boundary
  and one past it, and a date in a field, which is what `fs.Stats` is.
- `examples/dates-unsupported` — all six refusals, each with its reason in the
  fixture beside it.
- `compiler/core/tests/dates.rs` — three tests, three mutations, each caught:
  removing the representation, giving `valueOf` its own helper, and letting
  `toISOString` answer instead of refusing.
- `runtime/c/tests/dates.c` — 11 checks, every expected value read off node.
- `compiler/core/tests/runtime_signatures.rs` — the two read-only lists.
- `tooling/memory/cases/dates` — 17 / 17, argued first, and 51 before the borrow
  fix.
