# A frame object died at the throw, and its message with it

Under `NTS_RC=1`, this program answers `range:range:d code point 2147483647`
where node answers `range:Invalid code point 2147483647`:

    export function prefixed(n: number): string {
      try {
        throw new RangeError("Invalid code point " + n);
      } catch (error) {
        return error instanceof Error ? "range:" + (error as Error).message : "?";
      }
    }

Six of twenty-nine cases. The default provider agrees with node on all
twenty-nine, and so does the LLVM backend, and so does the JVM. One lane, and it
is the lane that counts.

## What the corruption is

`"range:"` is six characters. The result is thirty-five and so is node's. The
first six are right. Bytes 6 through 11 are `range:` again, and the rest is
`d code point 2147483647` — which is `Invalid code point 2147483647` with its
first six characters overwritten by `range:`.

So the destination of the second concatenation *was* the storage of its right
operand. The message had already been freed; the allocator handed the same
buffer back; `nts_concat` wrote its prefix into it and then copied the operand
out of the buffer it had just clobbered.

## Why it was freed

A frame object's header is `NTS_IMMORTAL`. `nts_retain` reads that word and
returns. So a reference to a frame object cannot be *owned* — there is no count
to raise — and what keeps its fields alive is the frame itself.
`rc::release_value` knows this: for `ObjectNew { frame: true }` it does not emit
a release, it emits the walk, loading each reference field and releasing that.

The walk goes where the object's live range ends. Here is the emission, before:

    v8 = nts_value_of_reference((NtsHeader *)v1, NTS_TAG_OBJECT);
    nts_value_retain(v8);
    v18 = v1->message;  nts_release((NtsHeader *)v18);
    v20 = v1->name;     nts_release((NtsHeader *)v20);
    ...
    v13 = v12->message;                  /* the handler, reading it back */
    v14 = nts_concat(v11, v13);

`v1`'s last mention *as `v1`* is the `Erase` on the first line. Ordinary
liveness ends its range there and the walk is emitted immediately after. The
retain on the line between is the one that would have covered it, and it is a
no-op by construction.

`own::repackages` already says what the missing rule is, in a comment written
for a different purpose: an `Erase` is "the operand under another name — what it
names is kept alive by whoever was already keeping the operand alive". Nobody
was. That sentence is a premise about the operand's live range, and it was being
used only to justify borrowing.

## The repair, and the half of it that was wrong first

`liveness::object_names` walks the renaming relation to a fixpoint — through
`Erase` and `Unerase`, and through block parameters, because a parameter is a
name for whatever every edge hands it. `analyze` then keeps a frame object live
wherever anything that names it is live.

That was correct for `prefixed` and it made seven examples fail to verify at
all: twenty-four `NotDominated` entries across six inserted blocks, `NTS_RC=1`
only. `examples/errors` has

    if (n > 1) throw new TypeError("t");
    if (n < -1) throw new RangeError("r");
    throw new Error("e");

caught in one handler. The handler's parameter names three objects and no arm
dominates it, so extending the object's range to cover the parameter puts a
release in a block the object does not dominate. There is nowhere to put the
walk, because the walk has to name the object and the object is not in scope.

So `undominated_names` finds those and `place_allocations` keeps them off the
frame, where the retain is real and the whole question is the runtime's. The
first version of that refused too much: five memory cases — `duck-typed`,
`imported-instanceof`, `in-narrowing`, `instanceof-class`, `upcast` — went from
zero heap allocations to seventeen each, for objects holding nothing but
numbers. An object with no reference fields has no walk to place;
`own::counted_here` does not count it at all. The refusal is only for objects
that have one.

## What it cost to not have it

`examples/code-points` is the fixture, and `merged` in it is the join case; the
memory case is `caught-message`, whose answer is the length of a string built
from the message, so the harness's "no answer changed" is what catches it rather
than a leak count.

Nothing in the corpus reached this. The shape needs three things at once: a
message the compiler *computes*, an error the frame holds, and a `catch` that
reads a field back out. `examples/errors` had two of the three — it throws
frame-placed errors and catches them — and asked only `instanceof`. A field
released early is invisible to a test that reads no field, which is why five
years of `throw`/`catch` coverage says nothing about it.

## What the case is worth beyond the bug

Two elisions fell out of writing the argument for `caught-message`'s numbers,
and both were already argued somewhere in the code and reaching nothing.

`own::counted_from`'s `Erase` arm names this exact case — "`throw new Error(m)`
caught in the same function erases an object that lives in the frame" — and
applied to no program, because a frame object *with reference fields* is counted
so that its own death emits the walk, and an `Error` has two. The name emits no
walk. Two operations per throw, each reading an immortal header and returning.

`own::costs_nothing` has answered `true` for a `ConstString` since
`constant-field` was written, so releasing an error's `name` should already have
been elided. What stopped it is that `inert_slots` gave up on the entire
function the moment it saw a call — "a call that is not harmless can write
through whatever it is handed". A callee can only write through what it is
*handed*, and both calls here are handed two strings and a double. Neither is a
path to an object.

`caught-message` reads 34 against a naive 102, and the two elisions are 51 of
the 68 that went.
