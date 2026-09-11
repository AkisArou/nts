# A layout is a shape and a class is an identity

    class A { x: number }   class B { x: number }
    new B() instanceof A    ours: true.  node: false.

Nothing refused. It compiled, ran, and answered wrongly — the only defect of the
week that emitted no diagnostic. One `nts_desc_NtsObj_A` in the program and
`static void B__constructor(NtsObj_A *)`: `class B` did not exist at run time.

Two classes with identical fields share a layout, which is **required** —
TypeScript is structurally typed, so `readA(new B())` must pass. They then
shared a *descriptor*, and `instance_of` compares descriptors. One field was
answering two questions, and shape is the right key for only one of them.

## The design I tried first, and the two things that killed it

Stop merging: keep two classes in two layouts. It worked on a fixture and was
wrong, and the two signals arrived within minutes of each other.

**The JVM lane measured it rather than agreeing.** Their shared-base emission —
the merged layout becomes a base, each class an empty subclass — needs a merged
layout to exist. Without one, `readA(new B())` becomes two unrelated JVM classes
and lands in `NTS4001`: a wrong answer traded for a *refusal*, which on their
lane is a regression in programs that work today. **The two halves are not
symmetric**, because C inserts an upcast the verifier already accepts and they
have no such freedom.

**And a test I had not read said the same thing.**
`readonly.rs::the_frozen_and_writable_classes_share_a_layout` asserts the
sharing on purpose, so that a sibling test cannot pass for the wrong reason.

So: shape stays in `Layout`, identity moves beside it as `Program::classes`,
keyed by the declaring symbol — the only thing separating two classes whose
every other property is their shape.

## Where the identity was actually lost, which was neither merge site

I guarded `collect_layouts`, watched the fixture go green, and it was still
broken the moment a `B` flowed where an `A` was declared — because `layout_of`
merges by shape too, eight thousand lines away, and had already put both ids in
one layout, so the later guard saw two class symbols and gave up.

Then neither site was the answer. **`canonicalize_objects` rewrites every object
type to its layout's representative**, so `lower_new` pushed `Object(B)` and the
backend received `Object(A)`. The checker had it right the whole way down: the
printed HIR said `obj#1` while `node_types` said 5.

One representative **per class** rather than per layout fixes it and costs
nothing it was buying. Both ids resolve to the same layout, so a value of one
where the other is declared is a conversion between a type and itself, which
`simplify` drops. What it stops being is *equal*, and only `instanceof` and
allocation ask that.

## Three more sites, each found by the previous one

**Per symbol was wrong: a generic has one symbol and many layouts.** `Fifo<A>`
and `Fifo<B>` are different structs, and grouping by symbol alone made
canonicalization collapse them — twelve modules stopped building with
`incompatible pointer types assigning to 'NtsObj_Fifo_2538_ *'`. An identity is
a symbol *and* a layout.

**Two classes of one name share a C symbol.** Two modules each declaring a
`ProtocolError` emitted one constant twice. The suffix carries the symbol when
the name is ambiguous, which is `unshared_layout_name`'s rule one level down.

**And the napi construction hole was a second place naming a descriptor** —
found only because the JVM lane went looking for the same thing on their side,
where their multi-member `instanceof` arm still had the defect their
single-member arm had just lost. Fixing it, I then spelled the name *beside*
`descriptor_for` instead of *through* it, named a constant that is only emitted
when a layout actually shares, and eight corpus cases stopped compiling with
`use of undeclared identifier`. **One fact, two derivations, third time in one
evening — and that one I introduced while fixing the second.**

## What it is worth

`X.isX(value)` is `value instanceof X` throughout this profile —
`BlockList.isBlockList`, `SocketAddress.isSocketAddress`, `AssertionError`,
`util.types`' whole surface. Those are the documented predicate rather than an
incidental use, and node's answer is identity. **A profile whose `instanceof`
cannot separate two declared classes cannot implement them.**

Nothing answered wrongly today: across all 22 modules the five merged groups hold
twelve classes and no `instanceof` in `runtime/` names any of them, verified from
both lanes. Every one was a wrong answer waiting for the first `instanceof`
anyone wrote.

## The shape worth keeping

Three times now the answer has been **keep the shared thing and add the
distinguishing one beside it** — `declared_by` beside the field, `ClassIdentity`
beside the layout, an empty subclass beside the base. The wrong answer each time
was to make the shared thing less shared.
