# A virtual call coerces to one signature and dispatches through another

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

`hir::verify` does not compare a call's argument types against its callee's
parameters, so `--prepared` prints

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

A cheaper guard worth having either way: `hir::verify` comparing each call's
argument types against its callee's declared parameters would have caught this
in the HIR, before any backend, and would catch the pointer-to-pointer case that
clang cannot.
