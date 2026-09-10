# A pointer to one is not a pointer to the other, one container along

    function sumErased(source: readonly unknown[]): number { ... }
    sumErased([1, 2, n]);

`number[]` is assignable to `readonly unknown[]` in TypeScript. Here they are
different arrays: eight bytes of `double` against a sixteen-byte `NtsValue`.
`coerce` passed it through, and it stopped at the verifier:

    invalid HIR: CallArgumentType { func: "ask", callee: "sumErased", at: 0,
      expected: Managed(Array(Erased)), found: Managed(Array(Float{64})) }
    Error: refusing to emit code from invalid HIR

The right outcome arriving at the wrong end. No source location, two `HirType`s
where the program wrote two element types, and the **whole build** stops rather
than the one function — so a module with one of these says nothing about the
twenty other constructs it contains.

It is the same hole as record 0257's structural cast, one container along, and
it was left when that one was closed: `coerce` checked `Object` against `Object`
and said nothing about `Array` against `Array`.

## Stricter than a prefix

An object read as another is safe when the target's fields are the source's
first fields: reading stops at the end of the target. An **array** is not: element
`i` is at `i * size`, so a shorter element at the same offsets is still the wrong
stride. Arrays need exact agreement.

**And exact agreement is not `HirType` equality**, which was the first version's
mistake. `Point` and the anonymous `{ x: number; y: number }` of a literal are
one layout and two `TypeId`s, so `Array(Object(88))` where `Array(Object(87))` is
wanted is a pointer to exactly the right bytes. Refusing those cost three cases
of `examples/destructuring` and one of `examples/objects`.

A prefix each way is equality, so the check is two calls to the helper record
0257 added rather than a second comparison written out — and only where both
elements are objects, because `laid_out_as_a_prefix` answers `true` for a target
it cannot lay out, which is right for its own question and exactly wrong for
this one.

`tooling/gate/example-refusals` caught it on the first run after the check went
in. That is the third thing that ledger has caught since it was written this
morning, and all three were mine.

## And the accident

`the_same_element` calls `laid_out_as_a_prefix`, which calls `layout_of`, which
**creates** a layout for a type that has none. `blockers/array-of-object-literals-has-no-layout`
went green with nothing aimed at it.

That is the second query-with-a-side-effect in a night. The first emitted
`incompatible pointer types assigning to 'NtsObj_Fn__174 *'` in six modules and
was caught twenty minutes into the gate; this one made something work.

**It was real.** Built and run:

    one()   {"name":"r","size":1}
    many()  [{"name":"r","size":1},{"name":"s","size":2}]

which is node's answer for both. The type was layable-out the whole time — a
field of array type forces its element's layout and a *returned* array did not,
so `[{ name: "r", size: 1 }]` typed `Row[]` reached the C emitter with none and
`NTS2006` came from the backend, one step past every message that names a source
line.

So the fix is one line in `lower_array_literal`, asking for it. A fix that
arrives as a side effect is not a fix until it is made deliberate, because it
depends on a coercion that may not happen — and the fixture would then have gone
green for a reason no one could find again. The blocker is kept as a guard
asserting the wrapper's `nts_to_napi_array_of_Row`, and its filing is kept
because what it argued about the wrapper being "done and inert" is what made one
line obviously sufficient.

Fifteen of the Node lane's seventy-one boundary refusals by element are
`Dirent[]` and `Listener[]`, which that filing named as what this would unblock
and did not yet.
