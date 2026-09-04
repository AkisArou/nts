# One feature, and the three bugs its ratchets found

`const shape: Shape = n > 0 ? new Circle(n) : new Square(-n)` was refused with
"an erased value where a concrete representation is wanted". It is how anyone
writes a hierarchy, and closing it took about twenty lines.

Each of the four deliverables then found a separate bug, none of them in the
feature, and none of them findable by the others. That is the record.

## The feature

The conditional's type is `Circle | Square`. Two classes are two
representations, so the union is an **erased** value with a tag; the declaration
says `Shape`, which both of them are. That is an upcast, and base-first layout
makes it free — a pointer to a `Circle` is a pointer to a `Shape` at the same
address with the base's fields at the same offsets. The tag is read off and
discarded, which is what `Unerase` already is.

`Unerase` is documented as *"the one place in this feature where being wrong is
silent rather than loud, so it is emitted from one function and nowhere else"*.
This is the second, and the licence is different in kind: the other one is
licensed by a **tag test on the path that reaches it**, and this one by a claim
about types — every arm of the union satisfies the target, so no path can arrive
carrying anything else.

The node whose type is the union is not always the node being coerced. For a
call argument or a return it is; for a variable declaration the node is the
*declaration*, whose type is the declared one — asking it compares `Shape` with
`Shape` and answers nothing. Found by instrumenting, because the first version
silently never fired.

**`all` rather than `any`, and the mutation survives.** Weakening the "every arm
descends" check to "some arm" fails no test and leaves the corpus at
`invalid HIR 0`. That is expected rather than a gap: TypeScript's assignability
already requires every arm to satisfy the target, so no well-typed source can
tell them apart. It stays as defence in depth — the lowering should not depend
on the checker having run — and the fact that it cannot be reached is written
beside it rather than papered over with a fixture that cannot exist.

## The example found a correctness bug in `in`, shipped an hour earlier

Probing the boundaries of the upcast, one case disagreed with node on 20 of 29:

    const v: Shape | Other = n > 0 ? new Circle(n) : new Other(1);
    return "r" in v ? 1 : 2;

Neither `Shape` nor `Other` declares `r`, so `in` folded to `false`. At run time
`v` is a `Circle`, which has one. Node says true.

**The declared arms are not the classes the value can be.** Inheritance is
additive: a subclass declares everything its base does and possibly more. So
"every arm has it" is safe from the arms alone and "no arm has it" is not, and a
fold to `false` walks into exactly that asymmetry. The candidate set is each arm
**and everything below it**.

Every unit test in `in_operator.rs` passed before the fix and after it, because
every fixture used interfaces with nothing below them. The test that catches it
is about a hierarchy specifically, and the mutation that restores the old
behaviour now fails both it and the differential.

## The memory floor found a reference-counting pessimism, two hops from its cause

`tooling/memory/cases/upcast` argued **0 operations and 0 allocations** before
measuring, and measured **34 operations** — retains and releases on objects
escape analysis had already put in the frame, where they are provably no-ops.

Three wrong guesses first. It is not the unerase, not the dispatch, and not the
allocation. It is one line in `own::mutating`'s fixpoint:

    OpKind::Call { .. } => true,

A virtual call was assumed to reach a store. Sound — and the cost is not paid
where the assumption is. `Shape#describe` stores nothing and calls
`this.area()`, so the fixpoint marked **`describe` itself** as mutating, and
`borrows_safely` then refused every borrow across a *direct* call to it. Two
hops, through a function that stores nothing, at a call that is not virtual.
Nothing at either end looks wrong.

The fix is that a slot reaches a store when some implementation in it does —
the join `flow::Context::slot_returns` already uses for the same reason.
**Computing the slots after the functions changes nothing**, which was the first
attempt: the two feed each other, so settling one against a stale other is a
fixed point of the wrong function. It terminates, it is stable, and it is the
answer you started with. A failure mode with no symptom.

34 → 0, and no timing instrument could ever have found it: a retain on an
immortal frame object *is* a no-op at run time. It costs a call and nothing else.

## The benchmark found dead code, through a build flag

    error: unused function 'Shape__area' [-Werror,-Wunused-function]

An abstract method is in `funcs` so a call through the slot can take its
function-pointer type from it — record 0090 — and nothing calls it, and no
vtable names it, because an abstract class is never instantiated. The C backend
emitted the `__builtin_unreachable()` stub anyway.

`examples/abstract-methods` compiled it happily for two hours. **The benchmark
build is the only one in this repository that turns warnings into errors**, so
the instrument that caught it was not a correctness harness at all — it was a
build setting, in a directory that exists for timing.

`Func::abstract_declaration` says so explicitly rather than leaving a backend to
pattern-match "one block, unreachable, no operations", which is also true of a
function that legitimately cannot return. The JVM's spelling of the same fact is
`ACC_ABSTRACT` with no `Code` attribute.

## Measured

    case      C++       nts C     nts LLVM   node      nts/C++   nts/node
    upcast    4.08 us   5.58 us   4.20 us    9.63 us   1.03x     0.44x

Against a C++ reference with a pure virtual and a `Shape *`, objects on the
stack in both lanes — neither escapes the iteration, so putting them on the heap
would measure `new` rather than dispatch, and would measure it in only one lane.
Three arms, so the call site is not bimorphic.

Not what `benches/cases/dispatch` measures: that is a `switch` over an integer
opcode, which is a jump table.

    upcast (memory)   naive 34   actual 0   ideal 0   100%   alloc 0   floor 0

## What this says about instruments

Three costs found this shift, by three instruments, and **not one of them was
built for what it caught**:

- A *check* cost the JVM session measured at 4.6x on `awfy-nbody`, invisible from
  this lane because `_Noreturn` makes the failure path free.
- A *borrow* cost invisible from any timing, because a retain on an immortal
  object is a no-op — only a counting instrument with a floor argued in advance
  could see it.
- A *dead code* cost invisible from every correctness harness, because emitting
  an unused static is free everywhere except under `-Werror`.

The generalisation is the JVM session's: **an instrument sees the costs its own
platform makes expensive, and is blind to the ones it makes free.** Three
backends is three blind spots that do not overlap. The cheaper corollary is that
build *settings* are another axis of the same thing, and `-Werror` in one
directory earned its keep today without anyone having intended it to.

## Ratchets

- `examples/upcast` — 203 cases against node on C, LLVM and under counting: a
  declaration, a call argument, a return, three arms, a field at the base type,
  arms at different depths, and a target that is a middle class rather than the
  root.
- `compiler/core/tests/upcast.rs` — two tests. The second pins that a union the
  *contextual type* dissolves is never erased at all, which is strictly better
  and is what the obvious "improvement" of routing every union through the new
  path would undo.
- `compiler/core/tests/in_operator.rs` — five tests now, the new one about a
  hierarchy.
- `tooling/memory/cases/upcast` — 0 / 0, argued before measuring, and red until
  the reference-counting fix.
- `benches/cases/upcast` — 1.03x C++, 0.44x node.
