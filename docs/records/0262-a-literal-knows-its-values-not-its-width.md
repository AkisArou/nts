# A literal knows its values, not its width

    type EventName = string | symbol;
    function initialise(names: readonly EventName[]): number { ... }
    initialise(["close", "error"]);

    an array of Managed(String) where an array of Erased is wanted

`lower_array_literal` took the literal's **own** type in preference to the
expected one, on a reason written in the code: "a literal with elements knows
what it holds". That is true of the values and false of the width they have to be
stored at, which is the slot's business. The literal was built as an array of
string pointers and then rejected, because an element is at `i * size` and there
is no prefix argument to fall back on.

## The measurement that located it

The Node lane annotated `stream`'s three shape constants `readonly EventName[]`
— accurate, they are event names — and measured the refusal **relocating** rather
than going:

    before   readable.ts:292, writable.ts:274, duplex.ts:83   7 sites in stream
    after    readable.ts:79,  writable.ts:58,  duplex.ts:53   7 sites in stream

Wrapper declines 65 to 65, `no wrapper for Readable` byte-identical. They
reverted it.

"The refusal relocates" is a much stronger statement than "annotating did not
help": it says the *initializer* is built at the wrong width, not that the
assignment is wrong. Without it the obvious place to look is the assignment, and
the assignment is correct.

Narrowing the parameter was not available either — `EventName` is
`string | symbol` because node's event names really can be symbols, and
`captureRejectionSymbol` is one.

## Two channels, and the second did not exist

A declaration's initializer already had one: `lower_expecting`, written so that a
bare `null` in it takes the slot's type. A call **argument** did not. It was
lowered and then coerced, and coercion can only reject what is already built.

So arguments ask the same question now, one question wider than `null` — and the
literal's own type yields to the slot's when both are arrays and their elements
differ. `initialise(["a", "bb"])` compiles, and so does an annotated constant,
which is what makes the Node lane's annotation work rather than move.

129 failing test files across `Readable`, `Writable` and `Transform` sit behind
those three constructors. **The corpus sites are unchanged in this commit**: the
constants are unannotated in `runtime/node`, which is the Node lane's, and an
unannotated `const shape = [...]` really is a `string[]` — passing it is a
conversion of an array that already exists, and that still refuses, correctly.

## Found by a refusal filed an hour earlier

`blockers/an-array-of-a-different-element` was filed for the *other* half of
this: a `number[]` handed to a `readonly unknown[]` parameter used to reach the
verifier as invalid HIR with no source location. Making it a named refusal is
what made the wrong-width literal say so out loud — and once it did, the question
"why is it being built at that width when the slot is known" answered itself.

The blocker is FIXED by the fix its own filing produced, within the hour, and is
kept as a guard. The refusal it names still stands for the case it was written
for: an array that already exists, of the wrong element, handed to a slot that
cannot take it. `subject` is no longer that case, because nothing exists before
the slot is known.
