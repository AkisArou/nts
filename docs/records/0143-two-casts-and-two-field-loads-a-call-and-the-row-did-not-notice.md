# 0143 — Two casts and two field loads a call, and the row did not notice

`optional-chain` is 2.12x, **96.84% of it in one method**, with no runtime calls
and 0.00 bytes/op. Nothing to blame but the emitted loop, which is the cleanest
starting position any row has offered today.

The loop unerases one field twice an iteration:

    aload 19 ; getfield NtsValue.ref ; checkcast nts/gen/Fn5__5     the null test
    ...
    aload 19 ; getfield NtsValue.ref ; checkcast nts/gen/Closure0   the call

Both are real `Unerase` ops in the IR -- `%19 = unerase %18 : managed<obj#4>`
for the test and `%39 = unerase %18 : managed<closure#524288>` for the receiver
-- and the second is nts-69's deliberate fresh `Unerase` at the narrower class.

**The first cast is dead.** `x.ref == null` and `((T) x.ref) == null` are the
same question, because a cast of null is null. So a null test against an
`Unerase` used for nothing else can load the field and `ifnull` it, skipping
both the cast and the slot.

    before   4 checkcast   6 getfield   2 if_acmpne   in `run$whole`
    after    2 checkcast   4 getfield   2 ifnonnull

    optional-chain   2.12x -> 2.12x     74.57 us -> 74.52 us

**Nothing.** IPC on that row is 3.90; the two loads and two casts were issuing
alongside work that was already the critical path, and removing them freed slots
nothing needed. That is record 0137's rule for the fourth time.

## The bug it caused first, which is the part worth keeping

The first version guarded on `Kind::Ref`, and **`Erased` is a `Kind::Ref` too**.
So it hijacked erased comparisons -- where `null` and `undefined` are different
tags *inside* one value and equality is `NtsValue.strictEq`, not a reference
test. `optional-chain` refused outright:

    NTS4001 a conversion this backend has no opcode for: an object to an f64

which is the same message nts-69's lowering produced this morning, from a
different cause. I nearly attributed it to them again; what settled it was
stashing my own change and watching the refusal go away.

`Kind` is a *machine* classification -- how a value is held -- and `HirType` is
what it means. A peephole about references has to ask the type, and asking the
kind got a class of value whose equality is not reference equality.

Reverted. `branch_null` in the emitter, which this would have made live, is
still called from nowhere -- a dead path by the rule that says superseded means
deleted, and now the second time I have gone looking for a use for it.
