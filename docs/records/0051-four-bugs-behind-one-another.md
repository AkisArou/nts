# 0051 — Four bugs behind one another

The LLVM backend agreed with node on 78 of 84 examples. It agrees on 82 now,
and the four that moved were found one behind the next: each fix let the
program get far enough to fail the following way.

The first was not a bug at all. Letting `let held;` compile — an evolving `any`,
0050 — gave a module a *global* of erased type, which nothing had before.

## `0` is not a value a struct can have

    @held = internal global { i32, i64 } 0

An erased value is a tag beside a payload, so its global is an aggregate, and
`0` is not one of its values. clang said "integer constant must have integer
type", which is the right complaint about the wrong thing: the constant is
fine, the *type* is an aggregate, and what it wanted was `zeroinitializer`.
Which is what `undefined` is — the tag zero and the payload zero together.

## `fcmp` on a struct

With `unknown` building, three more examples reached the next one:

    %v6 = fcmp one { i32, i64 } %v4, 0.0

A truthiness test on an erased value, lowered as a floating-point comparison.
The C backend calls `nts_value_truthy` and says why in a comment — "an erased
value carries which of those it is, so the rule is a switch on the tag rather
than a comparison" — and the LLVM backend had every case except that one, so
`Erased` fell through to the arm for doubles.

## A function with no name to call

`nts_value_truthy` is a `static inline` in the header. The C backend writes it
at the call site; the second backend emits calls *by name*, and a `static
inline` has none. So `nts_value_truthy_fn` joins `nts_to_int32_fn` and
`nts_round_fn`, which exist for exactly this and whose suffix says so.

## A table nothing checked

Adding it to the signature table put it out of order, and the LLVM table's own
test caught that immediately — a lookup there is a binary search, and an
unsorted entry answers `None`, which does not fail so much as go quiet.

Then the same check, run by hand against the *middle end's* table:

    nts_bigint_shr        >= nts_bigint_from_number
    nts_promise_number    >= nts_max_fn
    nts_str_last_index_of >= nts_str_is_well_formed
    nts_str_to_well_formed>= nts_str_repeat
    nts_string_from_char_code  >= nts_number_to_string_into
    nts_string_from_code_point >= nts_str_to_lower_case

Six places, and no test. `hir::runtime::declared` is a binary search too, and
what `None` means there is "the runtime does not declare this" — a sentence
about the runtime that is simply false. `parameters` answering `None` makes
`into_form` fall back to the `_into_fn` spelling; `result` answering `None`
skips a conversion the operation needed. Neither says anything.

One table had a guard and the other did not. Both do now, and the second one's
comment says which mistake it is for.

## `typeof` on a closure

With the truthiness fixed, `absent` stopped being rejected and started being
*wrong*: 42 where node says 45.

    (typeof f === "function" ? 1 : 0) +
    (typeof f === "object" ? 2 : 0) +

A closure answers `"function"`, so it carries its own tag, told apart by the id
rather than by the layout — `hir::is_closure_type` partitions the synthetic id
space to make that answerable in a backend. The C backend has had the case
since closures became values. The LLVM backend's `tag_of` went straight from
`String` to `Managed(_) => OBJECT`, and a closure is a `Managed`.

## What is left

Two examples. `map-and-set` and `mathops`, both `defined with type 'double' but
expected` something else — a type mismatch in the emitted IR, and a different
shape from any of these.
