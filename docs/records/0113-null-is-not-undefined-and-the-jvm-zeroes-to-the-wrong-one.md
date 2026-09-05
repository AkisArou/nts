# 0113 — `null` is not `undefined`, and the JVM zeroes to the wrong one

`benches/cases/optional-chain` had no `nts (JVM)` number. Chasing *why* found a
crash.

    Exception in thread "main" java.lang.NullPointerException:
      Cannot read field "ref" because "<local12>" is null
        at nts.gen.Program.run$whole(nts:13)

## The bug

    interface Held { fn?: (x: number) => number }
    const h: Held = {};
    if (i % 2 === 0) { h.fn = plusOne; }
    total = total + (h.fn?.(1) ?? 1);

`fn` is optional, so its type is erased and its slot is an `NtsValue`. Half the
iterations never assign it, and `?.` then reads the field of a field that was
never written.

**The C lane gets this right for free and that is why nobody noticed.**
`NtsValue` is a struct, `UNDEFINED` is tag 0, and zeroed storage *is* an
undefined value -- so `Func::initializes_receiver`'s promise that the JVM zeroes
the fields, which the plan quotes approvingly, is kept in C by the same
instruction that allocates.

On the JVM a reference field zeroes to `null`. That is a **different value**,
and not a harmless one: `null` is a legal TypeScript value in its own right, so
it cannot stand in for the absence even by convention. The generated `<init>`
established an object whose erased fields held a value the rest of the backend
had no way to represent.

## The fix

`ClassBuilder::constructor` now takes fields to set from static constants, and
`object_class` passes every declared field of erased type, sourced from
`NtsValue.UNDEFINED_VALUE`. It lands in the generated `<init>` rather than at
each `ObjectNew`, so it is one instruction sequence per class and an invariant of
the class rather than an obligation on every caller.

The emitter stays HIR-free: an entry says "set this field from that static", and
nothing in `jvm-emitter` learns what `UNDEFINED_VALUE` means.

## Why neither instrument caught it

Both were looking, and both missed, for different reasons worth separating.

- **The gate.** `examples/optional-access` passes and always has. It does not
  build an object with an *unassigned* optional field, which is the shape.
  100 of 100 examples agreeing is not 100 of 100 shapes.
- **The differential.** `nts check` on this very case reports *"checked 9 of 29
  cases; the rest were not reached (a pool value in a loop bound will do that)"*
  and then **"agreed on every case"**. The crash needs `rounds >= 2`; the pool
  put something else in the bound, so the loop body never ran both ways. The
  20 unreached cases are counted and reported -- the harness is honest about
  them -- but "agreed on every case" is the line a reader remembers.

The thing that found it was **a `--` in a table**, followed rather than
accepted. That is the whole argument for the rule that a refused construct and
an unmeasurable one must never look alike: the JVM column had three blanks, and
they turned out to be three different facts -- a refusal (`node-utf8` needs
`nts_concat`), a harness limit (`elementwise` takes an array the workload reader
cannot synthesise), and this, a crash. A single `--` would have made all three
look like the same shrug.

## The number

`optional-chain` now runs and answers `41024f8000000000`, which is what node
answers and what the hand-written Java reference committed today answers. It was
not producing a wrong number before; it was producing no number, which is how it
survived.
