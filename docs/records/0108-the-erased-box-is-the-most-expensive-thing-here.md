# 0108 — The erased box is the most expensive thing here

`benches/cases/in-narrowing`, with a hand-written Java reference written today:

| | ns/op | bytes/op |
| --- | ---: | ---: |
| hand-written Java | **1.42 us** | **0.0** |
| nts (JVM) | 15.48 us | **212,944.0** |
| C++ | 1.49 us | -- |

**10.87x**, which makes it the worst row this backend has against Java --
worse than `generator` was -- and the Java reference is *faster than the C++
one*, so it is not a lenient bar.

## What it is

The program narrows `Circle | Square | Wide` with `"radius" in shape`. That
union is `Erased` in the IR, so every shape is boxed into an `NtsValue` on the
way in and unboxed on the way out:

    Method nts/rt/NtsValue.ofObject   x6
    instanceof                        x4

579 bytecodes against the reference's 113. The reference allocates the *same*
4,096 shape objects per call and C2 scalar-replaces every one of them; ours
allocates ~52 bytes per iteration -- the shape plus its box -- and C2
eliminates none, because storing the shape into the box is a real escape.

## Confirmed by putting the box into the reference

One variable: give the hand-written Java a three-field value object holding a
tag, a number and the reference, and construct it the way `Erase` does.

| | ns/op | bytes/op |
| --- | ---: | ---: |
| reference, plain | 1.42 us | 0.0 |
| **reference, boxed** | **16.13 us** | **212,944.0** |
| nts (JVM) | 15.48 us | **212,944.0** |

**The allocation matches to the byte** and the time to within 4%. The box is
not a contributor to the gap; it is the gap. Nothing else this backend does to
this program costs anything measurable.

It also settles what the box costs *beyond* its own bytes: boxing the shape
makes the shape escape, so C2 stops scalar-replacing the object that would
otherwise have cost nothing either. Two objects are allocated per iteration
where the reference allocates none, and only one of them is the box.

## Why this row and not another

The plan named this the highest-value measurement in the design: *"`Erased`:
ship boxed, design for scalarised, **measure before building**"*, with the
`erasure-*` probes as the cases. Those probes have been in the table all along
at 1.00x-1.05x of the C lane, which reads like the boxed representation costing
nothing.

It costs nothing *there* because those cases store erased values and never
narrow them in a loop. `in-narrowing` allocates one per iteration, and the
difference between 1.05x and 10.87x is the whole question the plan asked.

**The row existed and the number did not, because there was no Java reference
to divide by.** Against the LLVM backend it reads 10x, and that ratio mixes a
JIT against a native binary and cannot separate boxing from anything else.
`ref.java` is what turned it into a statement about this backend.

## What the JVM makes possible and the IR does not currently say

A union of *object* types needs no box on this platform. `java.lang.Object` is
a universal reference and `instanceof` tests it directly -- which is what the
reference does, and what the emitted code does immediately after unboxing. The
box carries a tag that the class pointer already carries.

The plan says this for absence -- *"`T | null | undefined` over a reference
needs no tag at all"* -- and the same argument covers a union whose arms are
all objects. What is missing is that `HirType::Erased` does not say what its
arms are, so the backend cannot see that this one never holds a number.

`OpKind::InstanceOf { classes }` carries exactly that fact at the *use*. A
whole-program answer for the *value* is what would let the representation
change.

## Predicted, and wrong in the direction that matters

The plan's prediction was that boxing might survive because *"JDK 21 has no
`ReduceAllocationMerges`, so an object merged at a control-flow join is not
scalar-replaced"* -- and this program has a three-armed ternary, exactly that
shape. But the reference has the same three-armed merge and is scalar-replaced
completely. So the merge is not what defeats it here; **the box is**, and the
merge hypothesis would have sent me to the wrong fix.

## Fixed: 15.48us to 1.44us, and 212,944 bytes to zero

`compiler/codegen/jvm/src/unbox.rs`. A union whose arms are all objects is held
as a bare `java/lang/Object`.

| | ns/op | bytes/op | vs Java |
| --- | ---: | ---: | ---: |
| before | 15.48 us | 212,944 | 10.87x |
| **after** | **1.44 us** | **0.0** | **1.01x** |
| hand-written Java | 1.42 us | 0.0 | 1.00x |

**A 10.75x speedup on the row**, and it is now faster than both native
backends -- the C lane is 1.49us and LLVM 1.56us on the same program.

The allocation going to *zero* rather than to the shape's own bytes is the
predicted second-order effect arriving: with the box gone the shape stops
escaping, so C2 scalar-replaces it as well. Removing one allocation removed
two.

`erasure-typed`, `erasure-unknown`, `erasure-stored-typed` and `instanceof` are
unchanged to three digits, which is what the analysis being conservative is
supposed to look like: it declines every value it cannot prove, so a row it
does not apply to cannot move.

### What the analysis requires

Every definition erases a `Managed(Object(_))`; every use is `InstanceOf` or an
`Unerase` to an object; anything else disqualifies the class, including every
operation this backend has not considered. Values are joined by
block-parameter edges before the decision, for the reason `hir::specialize`
joins them -- a parameter and its arguments are one storage location seen from
different edges, and deciding them apart would let a loop header hold a bare
reference while a back edge hands it a box.

### The bug it produced, and what caught it

The single-class `instanceof` path was guarded and the multi-class one was not,
so a bare reference reached a `getfield` on `NtsValue`. `java -Xverify:all`
refused the class at load rather than letting it read a field off the wrong
object, and the differential reported *"aborted for a reason that is not the
program correctly declining its input"* rather than counting seventeen quiet
declines -- the classifier added earlier the same day, catching its author for
the second time.
