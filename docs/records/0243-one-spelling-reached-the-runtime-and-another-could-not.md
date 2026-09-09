# One spelling reached the runtime, and another could not

`Buffer extends Uint8Array` and declares no storage of its own, so `this` inside
`Buffer#fill` is already a `view<u8>`. The call still failed:

    NTS1003 `Buffer#fill` cannot be compiled because it calls `Uint8Array#fill`

`lower_super` builds the name `Uint8Array#fill` and looks for a compiled
function of it. There is none and there never will be — the method is the
runtime's — so `super.fill(...)` could not reach the typed-array methods that
`view.fill(...)` reaches.

**`subarray` was already implemented and `Buffer#subarray` refused anyway.** That
is the whole argument that this was never about the method: one spelling of the
call reached `lower_view_method` and another did not.

## The second half is the optional parameter

Routing `super` to the view methods moved the refusal rather than removing it:

    NTS1001 an erased value where a concrete representation is wanted

`Buffer#subarray(start?, end?)` forwards both to `super.subarray(start, end)`,
and an optional parameter is **erased** here. So the argument arriving at a view
method is routinely an erased value rather than a number, and coercing it says
so — truthfully, and about the wrong question. An absent optional means the
default.

Unerasing it is not the answer either: the payload of `undefined` is zero,
indistinguishable from an explicit `0`, and `end` defaults to the **length**.
`nts_value_number_or(value, fallback)` reads the tag where the tag still is.

Decided in the runtime rather than by a branch in the lowering, and the reason is
mechanical: `lower_branching_value` takes the merge's type from the *node*, and
at that point the node is the call rather than the endpoint.

## What it cleared, and what it did not

    Uint8Array#fill      compiles
    Uint8Array#subarray  compiles
    Buffer#subarray      compiles
    Buffer#slice         compiles

`Buffer.from` is next in the chain, behind `objectToBuffer` and `"length" in
value` on a bare `object`, which is a different construct with its own fixture.
So `string_decoder` is not green and this record does not claim it is.

## The example tested species construction by accident

The first version returned the subarray and compared its length. Node answered
**8** where the compiled program answered 5, for `new Bytes(8).subarray(3)`.

Both are right about their own question and only node is right about JavaScript.
`TypedArray.prototype.subarray` constructs through the **species** constructor:
node calls `new Bytes(buffer, byteOffset, length)`, and the fixture's `Bytes`
takes one parameter and hands it to `super`, so `new Uint8Array(buffer)` is a
view over the whole buffer.

Forty reported disagreements against a fix that was working, and the fix was not
what they were about. **A fixture reaches everything on the path between its call
and its answer, not only the thing it names** — and `subarray` on a subclass has
species construction on that path.

The cases are `fill` now, which returns the receiver and constructs nothing. The
species divergence is real, is named in the example's header, and is not this.
`runtime/node`'s `Buffer#subarray` sidesteps it exactly as node's own
`lib/buffer.js` does, by constructing from `view.buffer`, `view.byteOffset` and
`view.byteLength` rather than letting `subarray` choose.

## Three lists, one fact, again

`nts_value_number_or` had to be added to the header, to the LLVM signature table
in sorted position, and to `runtime::READS_ONLY` — and each of the three has a
test that failed in turn until it was. That is the good version of this pattern:
the erasure pair drifted seven times because nothing held it, and this family
caught three omissions in three runs.
