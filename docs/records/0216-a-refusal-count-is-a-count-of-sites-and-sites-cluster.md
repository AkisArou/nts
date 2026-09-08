# A refusal count is a count of sites, and sites cluster

`ManagedType::AnyView` closes 113 refusals across thirteen of the node profile's
twenty-two modules. It unblocks no module, and it was chosen because a count
said it would.

The count was `arraybufferview-parameter`: **621 sites, 17 of 22 modules**. That
is a true number and it is a count of *mentions*. What it is not is a count of
sites this variant closes, and the difference is where nearly all of it went:

    a parameter of unrepresentable type
      (a union of `ArrayBufferView` | `ArrayBuffer` | `SharedArrayBuffer` | string)

Bare `ArrayBufferView` is now a representation. The union containing it is a
different feature — an erased union of managed types — and most of the 621 are
that. Measured before and after on the same binary pair:

    fs 18   process 17   net 11   dgram http stream zlib 9   readline 8
    assert console events util 5   string_decoder 3

The Node lane measured it independently, split by whether the refusal's message
names the type, and got the sharper form of the same answer: 2–7% of each
module's primary refusals, four modules at exactly zero, **and no module reaching
zero residual**. Two instruments, one conclusion, and neither of us had asked the
question before the work started.

## The general shape, which is worse than this instance

Refusals are counted per *site*, and sites cluster on very few causes. `assert`
has 1,205 of them. One type accounts for 274:

    162  a property of unrepresentable type (a union of `PromiseWithResolvers` | null)
     83  `PromiseWithResolvers`
     29  arrays of it, and of unions of it

`PromiseWithResolvers<T>` is three fields. Written by hand with
`resolve: (value: number) => void` it lowers and runs today; what makes the
library's version unrepresentable is the parameter types of its closure fields,
`(value: T | PromiseLike<T>) => void` and `(reason?: any) => void`. `WeakRef` is
another 48 in the same module.

So a module's refusal count is dominated by however many times its source
mentions the two or three types it cannot represent, which is a fact about how
often node writes `#closeRequest` rather than about how much work is left.

This is `cascade-reach.mjs`'s caveat one level up. That one says a cone sizes a
*queue* rather than a step, because clearing the head can reveal the next
refusal in the same function. This says a count sizes a *corpus* rather than a
feature, because one cause is counted once per mention.

## And a denominator that was wrong in the other direction

Both counts above — mine and the Node lane's — are over a module's whole
tsconfig cone: its own source *and* the shared code it imports. Those are not
the same object, and for one module the difference reverses the reading.

    string_decoder, own source only
      before  4 refusals
      after   1

**All four of its own-source refusals were `ArrayBufferView`, and three are
gone.** The survivor is `ArrayBuffer.isView` at `main.ts:112`, a different
missing global. So the module whose source is most nearly all-`ArrayBufferView`
has, in its own code, almost nothing left to refuse.

That does not make "no module goes green" false — `string_decoder` publishes
neither of its two exports, both of which need a class or a value to be
publishable, which is a different feature again. It makes the cone-wide count
the wrong denominator for the question "is this change worth making", while
being the right one for "which module goes green". The table was built to answer
the second and got quoted against the first, by me.

So there are two honest sentences and they are not interchangeable:

- Over the whole cone, `AnyView` is 2-7% and moves no module.
- Over `string_decoder`'s own source, it is three refusals of four.

## What it does not say

Not that the work was wrong. `ArrayBufferView` is how every node API that takes
a view is declared, it has no element type, and refusing it was a refusal of
something the source states plainly. 113 refusals were wrong and are gone; a
representation the source needs is worth having whether or not it moves a
number. What is retired is the *reason it was chosen first*.

Nor that counting is useless. The Node lane's split — total, named, residual —
is a count that answers the question, and its four zeros are unarguable in a way
reachability is not. The fix is a better denominator, not fewer numbers.

## The check that was not in the count at all

Neither number said whether the representation was *complete*, and it was not.

`ArrayBufferView` was chosen because 621 sites mentioned it. What no count
asked is whether a value of the new type could get back to the one it came
from. `view instanceof Uint8Array` lowered -- the discrimination reads the
element kind out of the descriptor -- and the value stayed `AnyView` afterwards,
so the reconstruction refused. Half a round trip.

That is worse than refusing both halves. A refusal is a queue position; a
representation that discriminates and cannot be read back is a program the
compiler has told you it understands and then declines to finish. The
web-platform lane asked for the guarantee as a principle, before either of us
had tested it, because their BYOB path tests thirteen ways and rebuilds
thirteen ways; the node lane had found the same defect from the other side and
filed it as a readback gap. It was a live defect and neither of them had run it.

It cost four lines in `narrowed`. It was not in either measurement, and no
refinement of the denominator would have put it there.

## What was done instead

The refusal is now specific where it has to be. `length` of an `ArrayBufferView`
is `byteLength` divided by an element size the declaration does not give, so it
refuses by name and points at the question this type *can* answer, rather than
returning a number computed from a width nobody stated.

And the next block was chosen by cone rather than by count: `JSON.stringify`, at
the head of 36 of `path`'s 53 cascaded functions, with 11 exports behind it —
which the same lane's caveat says is a floor and not a total.
