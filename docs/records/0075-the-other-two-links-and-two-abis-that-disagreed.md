# 0075 — The other two links, and two ABIs that disagreed

`?.()` and `?.[]` were the last two of the optional family: 30 and 36 sites in
the node profile against `?.`'s twenty-six. Both are the same three steps `a?.b`
already had — lower the receiver once, test the absence its type admits, do the
work in the arm where it is present — with a different thing in the arm. A
member read, an element read, an indirect call.

What the arm holds is also *when* the arm is entered. `f?.(g())` must not call
`g` when `f` is absent, and `xs?.[next()]` must not step `next`, so the
arguments and the index are lowered inside the branch rather than before it.
`anAbsentCalleeEvaluatesNoArguments` counts that rather than asserting it.

Two optional links chain. A non-optional link after an optional one is still
refused, and the example's header no longer claims more than that.

## Two ABIs that disagreed, both found on the way

Neither is about optional chaining. Both are wrong *answers*, and both were
reachable before this commit — the first by ordinary code.

### A dispatched call narrowed its result and the implementation did not

    h.fn(21)   /* 42 in node, 7.3e8 here */

`Closure0__call` is emitted from the declared function type and returns
`double`. The call site had its result narrowed to `i32` by specialization, and
the C backend spells a dispatched call's signature from the *call's* types:

    ((int32_t (*)(NtsObj_Fn2 *, double))v2->header.descriptor->methods[0])(v2, v3)

A `double`-returning function called through an `int32_t`-returning pointer
reads the answer out of the wrong register. The mirror of the missing rule was
already there for *arguments*, three hundred lines away in `insert_conversions`:
"a callee this compilation does not define takes a `number` as a double, because
that is the ABI a declaration promises." The result had no such rule, and now
does — `Callee::Closure` and `Callee::Virtual` keep the representation their
declaration promises.

Verified against the pre-session build rather than assumed: it reproduces
identically at `617d9ef`, so it is older than this week.

### An optional call took its type from the expression

Then the same shape came back wearing `?.`. `h.fn?.(7)` is typed `number |
undefined` — the `undefined` is what the `?.` contributes, and the call cannot
produce it — and `call_through_closure` took the call's result type from the
expression. So the cast said `NtsValue (*)(...)` for a body returning `double`,
and the answer arrived as the bit pattern of a struct.

The call's type now comes from the *callee's* function signature. Same lesson as
above, one level up: a call through a table has two ends, and only the callee's
declaration is authoritative about what crosses.

## A segfault that is not this feature's, written down rather than fixed

    interface Inner { fn?: (x: number) => number }
    interface Outer { inner?: Inner }
    return { inner: { fn: (x) => x * 3 } };   // as an `Outer`

The inner literal gets its own anonymous type, `Type14`, whose `fn` is a
**pointer** — it is not optional there. The declared `Inner.fn` is optional and
therefore **erased**, a tag beside a payload. The literal is stored into an
erased slot and read back as an `Inner`, so eight bytes of a sixteen-byte slot
are taken as an address, and the program dies in `signal 11`.

It is pre-existing: the same crash reproduces with the `?.` written out longhand
as two `=== undefined` tests. It is the anonymous-type row of §4 with a sharper
edge than that row claims — not "the emitter has no cast to reconcile them" but
"the read is at the wrong representation and the process ends".

One attempt to refuse it is *not* in this commit. Checking the two layouts agree
in `coerce` never fires, because the store is into an erased slot and the
mismatch only becomes wrong at the *unerase*, where the payload's real type is no
longer known. The honest fix is at the store — coerce the literal to the
declared object type before erasing it, which needs the checker's property type
rather than the layout's — and it belongs with the anonymous-type work rather
than bolted to this.

Refusing beats crashing, and neither is done here. §1 says so in those words.
