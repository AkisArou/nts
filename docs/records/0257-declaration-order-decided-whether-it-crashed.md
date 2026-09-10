# Declaration order decided whether it crashed

    interface Named { name: string }
    class Thing { id: number; name: string }
    function readName(v: Named): number { return v.name.length; }
    readName(new Thing(5))

Node answers 6. **The compiled addon exits on SIGSEGV.**

`Thing.name` is at offset 32 and `Named.name` is at 24, and the emitter writes
`readName((NtsObj_Named *)v1)` — a raw pointer cast. So `readName` loads `id`, a
`double`, as an `NtsString *` and reads a length through it.

Write the same class the other way round:

    class Prefixed { name: string; id: number }

and `name` is at 24 in both layouts. Built, run, answers 6. **Swapping two field
declarations is the entire difference between a correct program and a crash**,
and nothing in the compiler, the gate, the examples or the differential said so.

## One sentence, true of the case it was written for

`coerce` ended:

    // Two managed types is an upcast, which base-first layout makes a
    // no-op pointer cast -- the verifier accepts it for that reason,
    // and the typechecker already decided it was legal.
    if have.is_managed() != want.is_managed() { ...refuse... }
    return Ok(value);

Base-first layout is a fact about a **base**. A subclass keeps its base's fields
at their offsets, so the cast is genuinely free — that is what
`blockers/upcast-to-base` was filed for, and the fix that closed it *added* the
cast. A structural target has no such guarantee, and the cast went on being
emitted for it.

`laid_out_as_a_prefix` is the check the comment was standing in for: the target's
fields must be the source's first fields, in order, with the same names **and**
the same representations. Either half alone lets a wrong one through — two fields
called `size` holding a `double` and an `NtsString *` are the same name and
different loads.

## Refused, not converted

A conversion would be a copy, and a copy is not the same object. A callee writing
through its parameter has to be visible to the caller — that is what a reference
means — so a copy trades a crash for a silent wrong answer, which is the worse of
the two. The prefix case is genuinely a no-op and stays allowed.

That is a placeholder for a design step and not an answer to it. What an
interface's representation should be, when both an object literal and a class
instance can be one, is the question `blockers/method-syntax-in-an-interface`
names. This makes the hazard loud instead of silent; it does not decide it.

## The blocker that predicted it, and stopped one step short

`blockers/method-syntax-in-an-interface` explains why a one-line
`MemberKind::Method` fix was **not** taken:

    `class C implements I` gives `C` its own layout from `C`'s type. If `I`
    gains a stored slot for a method member, `I`'s layout and `C`'s stop
    agreeing about offsets, and a `C` passed where an `I` is expected reads
    the wrong ones -- silently, which is the failure mode this compiler
    refuses everywhere else. It is the same shape as `upcast-to-base` being
    free only because base fields come first.

The mechanism, the consequence and the analogy, all correct, written as a reason
not to make a change — and already true without the change, for any interface
whose field order or field count differs from the class's. The step not taken was
asking whether it was already happening.

Two blockers were already reproducing it under another name. `annotated-const-read`
refused at the *read* (`code`, which `Error` does not declare) and
`optional-field-via-interface` at the *write* (`dest`, which `Carrier` does not
declare). Both are three-field structs being read out of two-field ones, and both
now refuse at the assignment that widens the object. The old messages were true
and described the symptom; the new one is checked rather than assumed.

## A checking predicate that changed the program it was checking

The first version asked `layout_of` for both types and refused if either answer
failed. **`layout_of` is not a query.** It builds a layout for a type that has
none and pushes it into the function's list — so asking about a *signature* type
materialised a fieldless `Fn__174` that had never existed, and assignments that
had been writing a closure into a slot of its own type started writing it into a
distinct struct:

    error: incompatible pointer types assigning to 'NtsObj_Fn__174 *'
           from 'NtsObj_Closure356 *'

Six modules. `dgram`, `fs`, `http`, `net`, `process` and one more, none of which
had anything to do with structural casts.

**Nothing before the gate's `addons` step saw it.** Clippy passed, the whole test
suite passed, all 150 examples agreed with node on all three backends, and the
`example-refusals` ledger was clean — because none of those compiles the twenty-two
modules. The step that caught it is the one that builds and loads each addon,
twenty minutes in.

A closure or a signature is answered now *before* `layout_of` is called, from the
snapshot's own type kind, which is both correct and free.

## The check over-fired, and the ledger built three hours earlier caught it

First gate run after: `library refuses 2, up from 1` and `module-functions
refuses 2 and is not in tooling/gate/example-refusals`. Closures —
`apply(double, n)` passes a function value to a signature-typed parameter, which
is two object types and no fields at all, and the class the compiler invents for
a closure is not in the snapshot, so `layout_of` answers `an object type that is
not in the snapshot` and the error was being propagated as a refusal.

A target with no layout has nothing to read through it, so that is an allow. A
target with fields whose *source* has no layout is still a refusal, because
something will be read and its position cannot be established.

**The example floor was green on that run.** Both examples went on agreeing over
their surviving functions, which is the exact failure `tooling/gate/example-refusals`
was written for a few hours earlier — and this is the second thing it has caught.
Both were mine.

## How it was found, which was not by looking for it

By reading the emitted C for something else. The field-index question in
`own.rs`'s borrow analysis needs to know whether two layouts can disagree about
where a field is, and the answer — measured, on a two-line program — was that
they can, and that nothing stops one being cast to the other.

The differential could not have found it. **595,855 comparisons across 21 modules
with 0 divergences**, from the Node lane, and the number is real: it says no
*exercised* surface misreads. The crash needs the field to be read through the
structural type, and a value only passed along is quietly fine — so a green
module is not evidence of absence, and neither is a clean differential.

A regex over the source could not have found it either. The Node lane tried:
28 hits including classes named `with` and `rather`, matched out of prose in
comments. They threw it away rather than send it, which is the right instinct and
the same one that has been killing instruments here all night.

The list that is worth having comes from the compiler's own refusals, one per
site, naming both types. **75 distinct sites across `runtime/node` and
`runtime/web-platform`, 458 refusals summed over the module builds.** The largest
are stream internals — `Writable` to `WritableImplementation` at 28, `Readable`
to `ErrorOrDestroyStream` at 28, `UVExceptionError` to `UVError` at 32 — and
every one of them was emitting a pointer cast between structs that disagree.

## No backend can express it, which is not what was expected

Asked whether a lane with no pointers gets this right, the JVM lane measured all
four shapes and answered that it gets it *wrong in the other direction*:

    structural, non-prefix   Thing { id; name }      refused
    structural, prefix       Prefixed { name; id }   refused
    `implements`, method     works, 29 of 29 vs node
    `implements`, data       a class file the verifier rejects -- found and
                             fixed by the question

The JVM relates classes by **name**. Coinciding offsets buy nothing when
`getfield Named.name` needs the object to *be* a `Named` in the class hierarchy,
so the prefix case — correct and free on C and LLVM — is not expressible there at
all. Its only answer is a conversion, which is the copy refused here for the same
reason.

So this is a limitation of the language as represented here rather than of one
backend, and the message says nothing about another backend getting it right,
because none does.

## And interface extension is laid out the other way round from class inheritance

    struct NtsObj_Base      { header; a; b; }
    struct NtsObj_DDerived  { header; a; b; c; }   class:     base first
    struct NtsObj_Extended  { header; c; a; b; }   interface: derived first

`class D extends B` puts the base's fields first, which is the whole reason
`upcast-to-base` is free. `interface E extends B` puts the *derived* field first,
so `E` is not a prefix of `B` and the cast is unsound — correctly refused, and
correctly refused for a shape that looks safe by construction.

The Node lane formed the opposite hypothesis, that the refusal over-fires on
`interface FileOptions extends BlobOptions` because there is nothing to reorder,
and **did not send it** without a layout to show. The layout says the refusal is
right and the site is a live hazard.

Which turns it into a layout question: if interface extension laid the base's
fields down first, the extension case would be free by the same argument that
makes a subclass free, and the refusal would stop firing on it without losing
anything. Not done here.

**And the first measurement of whether that is sufficient was wrong, in my own
favour, for a reason worth writing down.** The probe above also reports
`Base.a : Float` against `Extended.a : Int`, which reads as the two layouts
disagreeing about the field's *representation* as well as its position — and
would mean reordering could not be enough. It is an artifact of the probe: it
declares `class DBase { a; b }` beside `interface Base { a; b }`, structural
merging puts them on one layout, and the class's `this.a = n` makes `a` a
`Float` there while a literal's makes it an `Int` elsewhere. The divergence is
between a class layout and an interface layout, not between an interface and the
interface it extends.

Measured again with the class removed, on the shape the corpus actually has:

    BlobOptions [1]   type : Managed(String)   endings : Managed(String)
    FileOptions [3]   lastModified : Int       type : Managed(String)
      implements BlobOptions                   endings : Managed(String)

**The shared fields' representations are identical and only the position
differs.** So base-fields-first clears the extension case on its own, and the
Node lane should not flatten `FileOptions` — which is what it was about to do on
the strength of the wrong measurement, having asked first.
