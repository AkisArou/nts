# 0128 — Ten runtime calls removed, and the row did not move

**Status: built, measured at nothing, reverted.**

`absences$whole` called `NtsRuntime.irem` ten times -- `% 2`, `% 3`, `% 5`,
`% 7`, `% 11`, each twice. The helper exists because `idiv` throws on a zero
divisor where C is undefined and nothing upstream proves the divisor non-zero.
Every one of these divisors is a literal that cannot be zero, so the guard
cannot fire and the call cannot do anything the opcode would not.

    ten NtsRuntime.irem calls  ->  ten irem opcodes
    absences   1.22x -> 1.22x

**Nothing.** C2 inlines a four-line static and folds a comparison against a
constant, so the guard was already free and the call was already gone by the
time anything executed. The bytecode was more honest; the machine code was
identical.

## The part that was not obvious, and is worth keeping

The divisor does not arrive as a constant. A TypeScript numeric literal is an
`f64`, and specialization narrows it by inserting a **conversion** rather than
rewriting the constant, so the operand reaching the emitter is
`Convert(const 3 : f64)`. Asking `is this a ConstInt` finds nothing, which is
why the first version of this changed no call sites at all and looked like a
correct change that simply did not apply.

Anything else in this backend that wants to reason about a literal has the same
problem and will fail the same silent way.

And `-1` had to be excluded with zero: `Integer.MIN_VALUE / -1` overflows to
itself on the JVM where JavaScript answers 2147483648. That is a wrong answer
rather than a slower one, and it is the sort of edge a "provably safe" peephole
acquires the moment it stops being about zero.

## Why reverted rather than kept

It is correct, it removes a provably dead guard, and it measures nothing. The
standing rule prefers a reverted change with a reason to a kept one that
measured nothing, and thirty lines of emitter reasoning about literals is not
free to maintain -- the next person to touch `nonzero_literal` has to rediscover
the `-1` case and the conversion chain to change it safely.

The finding that survives is the one worth more anyway: **C2 already inlines
these helpers**, so "we call a helper where the reference uses an instruction"
is not a cost on this platform unless something stops the inlining.
