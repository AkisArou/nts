# What the declaration said, and the array nobody built

`hir::Param` was `{ name, ty, origin, known }`. The type does not carry the
declaration's shape: `...args: number[]` and `args: number[]` are the same
`Managed(Array(f64))`, and `x?: number` and `x: number = 1` are both an `f64`
slot the callee always has. TypeScript distinguishes all three.

`ParamShape` records it. The change is a field and an enum, and the reason it is
worth writing down is the standard it had to meet and the bug it found.

## The standard

This was asked for by the N-API backend, which was making two unsafe
approximations for want of it: treating every array parameter as a rest, and
inventing `0`/`false`/`""` for omitted ones. That is a consumer's convenience,
and a consumer's convenience is not a reason to change the HIR.

The justification that counts is the compiler's own. `lower_param` was
**already computing both halves** — the rest check reads `DOT_DOT_DOT_TOKEN`,
the default check calls `default_of` — and discarding them. Dropping a
distinction the language makes and the lowering has in hand is a precision loss
of the kind `docs/conformance/typescript.md` §16 exists to record.

And the penalty is nothing, verified rather than asserted: **no backend reads
the field.**

    $ grep -rn "ParamShape" compiler/codegen/ | wc -l
    0

A parameter is a parameter in every backend whatever its shape, because the work
a rest or a default implies happens at the *call* — `lower_arguments` gathers
the array and evaluates the default, which is where JavaScript evaluates it. The
cost is one discriminant on a struct already carrying a `String`, an `Origin`
and a `Facts`.

**What was refused on the same standard**: emitting a forwarding function for an
exported alias, so that N-API could wrap it. `const f = g` costs *nothing* today
— no global, no wrapper, the name resolves at each call site — and a shim would
be code in every artifact for one consumer's benefit. N-API refuses that export
instead.

## `Optional` and `Defaulted` are not one case

They look like the same thing and are observably different, and the difference
runs the opposite way to intuition.

An omitted **optional** parameter is `undefined` *inside the callee*, and the
callee can test for it. A caller can supply that.

An omitted **default** is never observable at all, because the **caller**
evaluates the initializer. `lower_arguments` does it at every call site, which
is where JavaScript does it. So a boundary that is not a compiled call site can
supply the first and cannot supply the second — which is why the enum lets N-API
*refuse* defaults honestly rather than implement them.

I had this backwards in the shared log and the Codex session corrected it: I
wrote that the callee evaluates the default, so a wrapper could call with fewer
arguments and let the callee fill it. `omitted_after` produces
`Omitted::Default` and `lower_arguments` evaluates it at the call. The
correction is theirs.

## The bug the example found

`examples/parameter-shapes` puts all three in one signature, in the order
TypeScript requires:

    function everything(first: number, second: number = 5, ...rest: number[])

    invalid HIR: [CallArgumentCount { callee: "everything", expected: 3, found: 2 }]

`everything(n)` supplies `first`; the defaults supply `second`; and **the array
is still owed**. `lower_arguments` builds an empty one when the call stops
exactly at the rest — `f(a, b)` against `f(a, b, ...rest)` — and that check runs
*before* the defaults are filled and returns early, so a call that reaches the
rest only after them never gets its array.

`omitted_after` breaks at a rest, correctly, and its comment said why:

    // A rest parameter is refused at the declaration, so its call sites
    // are refused with it.

**Which stopped being true when rest parameters landed.** The `break` stayed
right and the reason for it did not, and the gap between them was one missing
empty array. The fix is a second check after the loop; both are kept, because
the early one returns before `omitted_after` runs and that ordering is what
stops a call asking the signature about parameters past the rest.

This is the second time in two records that a **stale comment** marked the spot:
0090's was `examples/closures` describing a base-first layout that was never
built. A comment that was true when written and is false now is worse than no
comment, because it is evidence.

## The memory case that could not be written honestly

The rest fix builds an empty array per call that omits one, so the obvious
memory case is seventeen calls and a floor of zero — the arrays never escape,
`f` reads `rest.length` and returns a number.

Measured: **17 allocations, 17 operations.**

The floor of zero is not reachable, and the reason is worth recording rather
than working around. `ObjectNew` carries a `frame: bool` and `ArrayNew` does
not, so **an array is always a heap object in this compiler**, however plainly
it dies with the call that made it. `global-array` reads `alloc 0` because its
array is a global allocated once, not because an array was ever framed.

So neither number could be written down honestly. Zero asserts a capability that
does not exist; seventeen charges the program for a compiler decision, which
`pile-shuffle`'s `expected` records as a mistake already made twice. The case
was removed rather than fitted to the measurement, and the measurement is here:

**Frame-placed arrays are named work.** 17 empty arrays per 17 calls, none of
them escaping, in the smallest program that has the shape.

### And the framing I put on that was wrong

I passed the finding to the JVM session with the note that frame-placed arrays
are something this lane could gain and theirs structurally cannot — a JVM array
being a heap object with a header either way. Their own plan says the same thing
in the same direction, under "structurally cannot win".

They measured instead of agreeing: **0.00 bytes/op**, over roughly 470 million
empty arrays, for exactly this shape. C2 scalar-replaces them, and the growable
wrapper too — an object with a field pointing at a backing array, both removed.
The control is what makes the zero mean something: an 80-element non-escaping
array reads 131,200 bytes/op, which is 200 × 656, a 16-byte header plus 640 of
payload. The arithmetic comes out right rather than the number merely being
plausible, and the boundary is exact because it sits on
`EliminateAllocationArraySizeLimit` — 64 elements, not one past.

**The error was the same in both directions, and it is a species we had not
named.** Each of us took *"the IR cannot express it"* to mean *"the cost is
paid"*. Not a cost invisible from a lane, which is the shape 0091 catalogues —
a cost **assumed from an expressiveness gap**. It is cheaper to assert than to
measure, it reads exactly like an engineering fact, and the tell is that the
sentence contains no number and does not feel like it needs one.

The seventeen still stands as the argument for `ArrayNew` gaining a `frame`
flag: C2 removing the allocation on the JVM says nothing about clang, which has
no equivalent pass over `nts_array_new`, and the C lane pays it unconditionally
today. Their zero is a reason to stop claiming the JVM would benefit, not a
reason to drop the work.

## Ratchets

- `examples/parameter-shapes` — 145 cases against node on C, LLVM and under
  counting: a rest beside an ordinary array parameter of the same type, a
  default, an optional, and all three in one signature.
- `compiler/core/tests/param_shape.rs` — three tests, three mutations, each
  failing a different one: calling every array parameter a rest, collapsing
  optional into defaulted, and dropping the empty rest array (which the
  differential also catches, as invalid HIR).
- No memory case, for the reason above.
- No benchmark row: the field is not read by any backend, so nothing it does can
  be timed. The rest fix changes an invalid program into a correct one, which is
  a correctness result rather than a speed one.
