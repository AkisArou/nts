# A summary table is a second derivation

The global-object table listed, as gaps:

```text
ReferenceError, SyntaxError, EvalError, AggregateError, SuppressedError
```

Three of those five are in `hir::builtin::ERRORS` and have been for some time.
Thrown, all nine of the standard error classes in one file, **seven compile and
two do not**.

The list in `builtin.rs` is the fact. The table column is a hand-made copy of
it, and a copy diverges the first time the original moves — silently, because
nothing relates them and nothing ever will: one is Rust and one is a markdown
cell.

## Four ways a figure went wrong in one night, and they need different repairs

- **Printed and ignored.** `example-refusals` said `down from 2 -- edit the
  table` on every run since the commit that earned it, and passed. [[0317]]
- **Truncated without saying so.** A census printing 25 of 204 roots, read as a
  set. [[0319]]
- **Never measured.** "129 refusal sites, one per member" — members times
  classes, a calculation standing where a measurement should be. [[0320]]
- **Copied, then the original moved.** This one.

Only the first is caught by reading the output. The second by asking the tool
what it left out. The third by noticing the number has a derivation instead of a
provenance. The fourth only by re-deriving from the source of truth — which for
this table is one probe file with nine throws in it, and took a minute.

## The thing the correction found, which is worth more than the correction

Both remaining gaps share one reason, and it is the list's own premise: its
members hold `{ message, name }` and nothing else. `AggregateError` carries
`errors`; `SuppressedError` carries `error` and `suppressed`. So the gap is not
five classes nobody got to — it is **one structural limit with two instances**.

And `hir::builtin` already wrote down what that costs:

> A class absent from this list does not merely fail where it is thrown; it
> refuses its caller, and its caller's caller.

Followed to the end:

```text
AggregateError absent from builtin::ERRORS
  -> NodeAggregateError extends it, so has no layout
     -> `value.code` over five instanceof-narrowed arms refuses, as
        `code` on a union one of whose members has no layout
        internal/errors.ts:1256, imported by every module
```

6 things, 7 sites, 24 module cones. A probe ruled out the obvious alternative
first — a user class carrying an array field compiles and reads `.code` through
a union perfectly well — so it is the **base being unprovided**, not the array,
which is what the `instanceof` row had reasonably guessed.

That is [[0301]]'s rule paying out: the chain found a root that no census row
names, because the census names the message at the *end* of the chain and the
root is three links back.
