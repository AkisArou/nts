# A class is a value, and an overridden getter was not a call

The largest single refusal in `runtime/node` was **1,865 occurrences across 88
sites**:

    NTS1001 `TypeError` used as a value rather than as a type

True, and not a question about capability. `err.constructor === TypeError` is
how a program asks which error it caught, and 64 of the 88 are one idiom:

    override get ["constructor"](): unknown { return TypeError; }

written so that code checking the built-in agrees about a subclass.

It closed with no new machinery, and building it found a wrong answer that had
nothing to do with it.

## What a class as a value has to be

One object per class, the same one wherever the name is written, `typeof`
`"function"`, comparable by identity. Nothing reads a field of it: the only
things a program does with `TypeError`-the-value are compare it, ask its
`typeof`, and pass it along.

**That is a named function used as a value with a different source.** So it is
the same operation — `OpKind::ClosureStatic`, an immortal static beside its
descriptor — at a type id in a reserved band at the top of the space. The band
is above the closures rather than beside them because closures are numbered
upward by a counter this cannot see; a program with enough of them would reach
any fixed offset.

The tag falls out rather than being arranged. `tags::of` reads
`ManagedType::Object(ty) if is_closure_type(ty) => FUNCTION`, and a token's id
is in that range, so `typeof TypeError === "function"` is right with no rule
about classes anywhere.

The emitted C is the whole design in four lines:

    static NtsObj_Ctor_TypeError nts_fnval_NtsObj_Ctor_TypeError =
        {{&nts_desc_NtsObj_Ctor_TypeError, NTS_IMMORTAL, 0, 0}};
    ...
    v3 = &nts_fnval_NtsObj_Ctor_TypeError;
    v4 = nts_value_eq_reference(v2, (const NtsHeader *)v3);

## The name, which is the third time

A token holds nothing — no fields, no methods, no base — so `Layout::same_shape`
says every one of them is every other one. Merged, `err.constructor ===
TypeError` would be true of a `RangeError`: exactly the wrong answer the four
provided error classes gave before they were given a nominal guard, and exactly
the one the function types gave before record 0096 gave them one.

**Third family, same cause, and 0096 said it would recur** — shape cannot answer
a nominal question about a shape with nothing in it. So `collect_layouts` gains
`two_tokens` beside `two_errors` and `two_signatures`, and the three read as one
paragraph because they are one problem.

## And the wrong answer it found

The example wanted the idiom the refusal came from, so it has a base and a
subclass that override `get ["constructor"]`. It disagreed with node on 20 of 29
cases. Reducing it:

    class Base   { get plain(): number { return 1; } }
    class Narrow extends Base { override get plain(): number { return 2; } }
    const b: Base = new Narrow();
    b.plain      // nts: 1     node: 2

**An overridden accessor was not dispatched.** `accessor_callee` returned a
*name*, and both of its call sites wrapped it in `Callee::Direct` — so the
getter of the class the *static type* declares ran, whatever the receiver was.
Getters and setters alike, and on both spellings of the member.

The hierarchy had the slot the whole time. `declared_methods` records an
accessor under `get x` precisely so that it can be overridden, the slot was
allocated, and nothing ever read it back. Nothing in the corpus overrode one, so
nothing said so.

The fix is `resolve_method`'s decision, letter for letter, written once in
`accessor_callee` rather than at each of its two sites — for the reason the
hierarchy's own comment gives about the base: two places that must agree is how
this goes wrong.

**Found by a feature that is not about it.** The fourth time in this project's
records: the `in` bug came out of the upcast's example, a dead C stub out of the
upcast's benchmark, `Object.keys` out of `delete`'s soundness argument, and this
out of a class-as-a-value fixture that needed a subclass to be interesting.

## Measured

    runtime/node   9,208 refusals  ->  7,324

    `TypeError` used as a value    777 -> 0
    `Error`     used as a value    752 -> 0
    `RangeError`used as a value    294 -> 0
    `URIError`  used as a value     42 -> 0

The largest single drop this project has recorded. The profile ceiling in
`tooling/gate/all.sh` comes down 9,350 → 7,450.

## What is refused, and named

- **Calling** a class value. `TypeError(m)` is `new TypeError(m)` in JavaScript
  and would need the token to carry a `call` that constructs. Zero sites.
- **A union of two class values.** `cond ? TypeError : RangeError` gets a single
  object type from the checker rather than a union of the two constructors, so
  nothing sees two representations to erase and the backend declines with
  `NTS2006 an object type with no layout`. Loud rather than wrong, and zero
  sites — the idiom is `return TypeError` and `value === TypeError`.

## Ratchets

- `examples/class-values` — 145 cases against node on C, LLVM and under
  counting: identity across two mentions, four classes distinct from each other,
  `typeof`, the negative against a string and a number, and the
  `constructor`-getter idiom through a subclass.
- `examples/accessors` — four exports added, 261 cases: an overridden getter in
  both spellings, an override two classes up, an overridden setter, and an
  accessor **nobody** overrides, which must stay a static call. The last is the
  half that a fix dispatching every accessor would break.
- `compiler/core/tests/class_values.rs` — three tests. One token per class *and*
  one class per token; four layouts that do not merge; no `ObjectNew` for a
  token.
- `compiler/core/tests/member_names.rs` — `an_overridden_accessor_is_dispatched`,
  both halves.
- Three mutations, each failing what it should: `Callee::Direct` again fails the
  accessor test alone; dropping `two_tokens` fails identity and merging; one
  token for every class fails the same two.
- `tooling/memory/cases/class-value` — 0 / 0, argued before measuring. The
  failure it is aimed at is a fresh object per mention that is then *interned*,
  which agrees with node on every case and allocates seventeen times.
- **No benchmark row, and both halves measured rather than asserted.** A class
  value is a constant address and a pointer compare, which is what
  `benches/cases/instanceof` already times. An overridden accessor emits
  **byte-identical C** to an overridden method of the same shape once the
  member's name is normalised — same vtable, same indirect call — so
  `dispatch` and `upcast` price it, and an accessor nobody overrides is still a
  direct call, which bounds the cost to the members that need it.
