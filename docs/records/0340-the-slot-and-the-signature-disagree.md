# A virtual call coerced to one signature and dispatched through another

`emit-c` writes C that clang rejects:

    error: passing 'NtsString *' (aka 'struct NtsHeader *') to parameter of
    incompatible type 'NtsValue' (aka 'struct NtsValue')
        ((NtsObj_EventEmitter * (*)(NtsObj_EventEmitter *, NtsValue, NtsValue))
           v0->header.descriptor->methods[51])((NtsObj_EventEmitter *)v0, v1, v2);

The receiver is cast and the arguments are not, because pointer-to-pointer is a
cast and pointer-to-tagged-value is a construction.

## The two signatures

A call's arguments are coerced by `coerce_to_parameter`, which reads
`parameter_representation` — the signature **the checker resolved**. The call
then dispatches through `Callee::Virtual { slot, declared }`, whose signature
comes from the class that **declares** the slot. Where an interface narrows a
parameter relative to the implementing class, those differ:

```text
  Narrow.on(type: string, …)                  the call coerces to managed<str>
  Emitter#on(type: string | symbol, …)        the slot takes erased
```

`hir::verify` **does** compare a call's argument types against its callee's
parameters — and only for `Callee::Direct`. A virtual call is `continue`d over
before the check is reached, so `--prepared` prints

    %5 = call.virtual[51] EventEmitter#prependListener(%0, %1, %2)

with `%1 : managed<str>` against `type: erased` and calls it well-formed. The
only objection comes from the C compiler, and only because one side is a struct.
**Two mismatched pointer types would compile, link and be wrong.**

`blockers/an-interface-narrowing-a-virtual-parameter` is the 25-line case.

## Found by removing an unrelated refusal, for the second time in a day

`runtime/node/stream/src/legacy.ts:72` is

```ts
if (typeof emitter.prependListener === "function") {
  emitter.prependListener(event, listener);
```

and `typeof o.m === "function"` on an optional method refused until this was
being worked on, so that function had never been lowered and this call had never
been emitted. Lowering the test took `addons.sh` from `24 of 24` to
`17 of 24 still build, 7 regressed`. The first three reasons printed under each
module named `new Set`, `Uint8Array.of` and `Object.getPrototypeOf` — the next
blockers, chosen by a `head -3` over anything error-shaped. The cause was eleven
clang errors further down.

Same shape as [[0339]] the same day: a latent defect sitting behind a refusal,
published the moment the refusal cleared, and charged to the change that cleared
it. Two in one day is enough to call it the normal case rather than a
coincidence.

## What I got wrong on the way, which is the part to keep

I claimed twice, in a peer message and to myself, that the defect **reproduced
on the gated binary** — and my evidence was

```sh
clang -std=c11 -fsyntax-only -I $D $D/program.c 2>&1 | grep -c "error:"   # 2
```

run against a directory `emit-c` had never written, because the fixture used
`new` on an `abstract class` and did not typecheck. The two errors were

```text
  clang: error: no such file or directory: '…/program.c'
  clang: error: no input files
```

Both contain `error:`. **A count of clang errors counts clang's errors about
clang.** The conclusion happened to be right — a fixture that typechecks
reproduces it on HEAD, one error — but I held it for twenty minutes on a
measurement that had not run, and I had a memory note about exactly this.

The tell was available and I walked past it: `grep -c` on a compiler's output is
a count of *lines*, and the two things that produce those lines — a rejected
translation unit and a missing one — are the two outcomes a probe must never
merge. **Assert the artifact exists before measuring it**, as its own statement
with its own failure:

    test -f "$OUT/program.c" || { echo "NO program.c"; exit 1; }

## What is not fixed

The fix is to coerce a virtual call's arguments to the **slot's** parameters
rather than the resolved declaration's. `lower_object_method` decides the callee
at line 32025 and lowers the arguments at 32028, so the information is in hand
and in the right order; what is missing is the declaring type's parameter list,
which `hierarchy.declaring` plus `member_declaration` can reach.

Not done here. It is a change to the path every method call takes, and getting
it wrong mis-coerces every call in the tree — not a thing to half-apply in a
shared file at the end of a long session. The `typeof` work that exposed it is
held back with it, as a patch rather than a commit, because landing it alone
regresses 7 addons.

## Both obvious fixes were tried and both are wrong, which is the map

**Coercing at lowering is the wrong layer.** `lower_object_method` decides the
callee before it lowers the arguments, so the information is in hand and in the
right order, and the declaring type's parameters are one `hierarchy.declaring`
plus a `TypeKind::Function` away. Written that way it produces

    invalid HIR: CallArgumentType { func: "Closure726#call",
      callee: "EventEmitter#off", at: 2,
      expected: Managed(Object(TypeId(12153))), found: Erased }

and `fs` stops building. The checker's declaration is not the emitted
signature: `unerase` and `specialize` narrow parameters *after* lowering, so
coercing to what the checker says erases an argument the final function takes
concretely. **The target has to be the final signature, which means the
conversion belongs where `specialize::insert_conversions` already puts the
integer ones** — it runs with `signatures::Expected`, and it currently looks up
`Callee::Direct` only.

**Extending the verifier is right and does not stand alone.** `compatible`
already holds exactly the rule this needs: two references are interchangeable
*unless either is `Erased`*, which is the pointer-versus-tagged-value
distinction the C backend cannot express as a cast. Routing `Callee::Virtual`
through the same check reports the blocker precisely —

    CallArgumentType { func: "through@0obj1", callee: "Emitter#on", at: 1,
      expected: Erased, found: Managed(String) }

— and immediately surfaces a **second, different** class of pre-existing
mismatch in `stream`, `fs`, `http` and `zlib`:

    CallResultType { func: "Closure422#call", callee: "AsyncWriter#fail",
      expected: Void, found: Erased }

So the check cannot land before the conversions do, and the conversions are two
kinds rather than one. Measured rather than estimated: `net`, `util`, `events`
and `buffer` are clean, four modules are not.

**The order the work has to go in**, from here:

1. `insert_conversions` looks up `Callee::Virtual { declared }` in `Expected`,
   the way it already does for `Direct`.
2. It gains a reference arm — `Managed(..)` into an `Erased` parameter is an
   `Erase`, and the reverse is an `Unerase` — beside the integer one.
3. The result mismatches are triaged; a `Void` callee whose call site is typed
   `Erased` is a different question from an argument and may be a lowering
   fault rather than a missing conversion.
4. Only then does `verify` take `Callee::Virtual`, and from then on this class
   fails in the HIR instead of in clang — including the two-pointer case clang
   cannot see.

## Steps 1 and 2 are done; the check is not

`insert_conversions` now looks up `Callee::Virtual { declared }` in `Expected`
— the same key `Direct` uses, and the only reason it was not consulted is that
nothing asked — and its argument rule has a reference arm beside the integer
one. `convert` already knew how to emit the `Erase`: it has said since it was
written that *"crossing the erased boundary is not a coercion"* and emits
`Erase` rather than a cast, and nothing reached it for a call argument because
the only rule that looked at the target asked about integers.

Two matches widened. The fix is smaller than the diagnosis by an order of
magnitude, which is the usual ratio when the diagnosis is the work.

    blocker               emitted C compiles, and `blockers-check.mjs`
                          reports `guard ok` rather than `reproduces`
    addons.sh             24 of 24, 0 regressed
    nts-core              359 passed

Controlled: deleting the one arm makes the guard say *"the emitted C stopped
compiling"* and quote the clang error, so it is a check that can fail.

**Unerasing is deliberately absent.** An argument already erased whose callee
wants something concrete is the mirror rule, and nothing has produced one that
is not a signature this pass narrowed itself. A rule with no case behind it is a
guess about which mismatches are safe — `verify::compatible`'s own standing
argument, borrowed one layer down.

## Step 4: the arguments are checked, and the results are not

`verify` now routes `Callee::Virtual` into the same argument check `Direct` has
always had — so from here this class fails in the HIR rather than in clang, and
`compatible` sees the case clang cannot: **two mismatched pointer types compile,
link and are wrong**. Zero violations across ten modules. Controlled: deleting
the `Erase` arm in `insert_conversions` makes it say

    invalid HIR: CallArgumentType { func: "through@0obj1", callee: "Emitter#on",
      at: 1, expected: Erased, found: Managed(String) }

rather than letting clang find it two steps later.

**The result check is deliberately left off, and that is measured rather than
conceded.** `AsyncWriter.fail?(): unknown` over an implementation returning
`void` gives `CallResultType { expected: Void, found: Erased }` in `stream`,
`fs`, `http` and `zlib`, and **no backend ever sees it**: `stream`'s emitted C
holds 416 void-returning functions and not one assignment from any of them,
because an unused result is dropped before emission. Reporting it would redden
the gate over something nobody can act on — worse than the silence it replaces,
because it teaches a reader to skip the check.

What would make it landable is answering *why* the call is typed from the
interface's `unknown` rather than the slot's `Void` at all. That is a lowering
question and is the one still open here.

A `MissingCallee` is also not reported for a virtual callee with no emitted
function: the slot is reached through a descriptor rather than by symbol, so an
unemitted declaration is not the undefined-symbol hazard that check exists for.
