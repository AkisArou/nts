# 0039 — Six examples agreed about nothing

The queue's seventh primitive is object and class, and its audit found no gap in
the primitive. It found one in the instrument that was measuring it.

## The primitive, first

**Representation.** An object is a header and its fields, laid out by the
platform C ABI's rule and checked against `offsetof` with a `_Static_assert` per
field on every build — 10,340 assertions across the node profile, and clang
agrees with all of them. Two classes of the same shape share one layout,
deliberately, because TypeScript is structurally typed.

**Operations.** The refusals are dominated by what that decision costs:

    Object.prototype / String / Number / Boolean.prototype   166
    a class used as a value (`EventEmitter`)                  48
    a property `prototype` of unrepresentable type (any)      47
    a class of unrepresentable type (a function type)         35
    `constructor` on a union                                  21

`instanceof` and `.constructor` are the two places JavaScript stays *nominal* at
run time, and neither can be built on a layout two classes share. That is
already argued in `typescript.md`; what this audit adds is the price.

**Memory.** Eight cases, all at both floors: `array-of-objects` 18/18,
`local-anchor` 17/17, `nulled-field` 17/17, `readonly-anchor` 40/2,
`store-elsewhere` 33/33, `traversal` 33/33, `pile-shuffle` 9/11, `cycle` 0/0.

**Speed.** Five rows, every one ahead of node:

    objects        1.52 us   C++ 1.52 us   node 1.82 us   1.00x C++   0.83x node
    dispatch      27.87 us   C++ 27.83 us  node 40.04 us  1.00x C++   0.70x node
    awfy-list      7.93 us   C++ 7.36 us   node 16.08 us  1.08x C++   0.49x node
    awfy-towers   16.40 us   C++ 12.60 us  node 32.11 us  1.30x C++   0.51x node
    awfy-bounce    6.44 us   C++ 4.13 us   node 12.44 us  1.56x C++   0.52x node

`objects` and `dispatch` are at C++ parity exactly.

## And then the instrument

`examples/classes` exports an enum, an interface, an abstract class, a subclass,
a `let`, a `const` and a default class — and **not one function**. The
differential needs an exported function taking and returning scalars to have
anything to drive, so `nts check` printed "nothing to check" and exited 0
*before it ever tried to lower the file*.

It counted toward **91 of 91 agree with node** while comparing no answers. It
was also hiding three refusals: `enum` in every shape, an abstract method, and
an `async` method. Adding functions to drive it surfaced all three at once.

The functions cannot stay, and that is the interesting part: **node will not run
the file**. `export enum Color` is not something node's type stripping executes,
so there can be no oracle for it. `examples/classes` is a lowering fixture and
is right to be one.

Six of the eighty-nine are: `advanced`, `calls`, `classes`, `jsx`,
`promise-constructor`, `types`.

## What changed

The number, not the programs.

    85 of 85 agree with node
      6 compared nothing (no exported function with scalar arguments and a
        scalar result): advanced calls classes jsx promise-constructor types

`gate.sh`, `rc.sh` and both LLVM steps report it the same way, and the LLVM
ratchet floors move 80/89 to 74/83 — the same set of programs, with a comment
saying so, because a bare number going down reads as a regression to whoever
finds it next.

Class correctness was never unverified: `instances`, `inheritance`, `accessors`,
`fluent-this`, `field-defaults`, `decided-statics` and `cycles` all drive real
functions and all agree with node. What was wrong was the headline.

## Two shell traps, both left as comments where they bit

- A nested `case` inside an `elif` condition ends the **outer** `case` arm. The
  runner is one `case` per example, so the inner one silently broke it.
- An apostrophe in a comment closes the `sh -c '...'` string that comment lives
  inside. `gate.sh`'s survived; the same comment in `rc.sh` said "gate.sh's" and
  did not.

Both produced "syntax error: unexpected end of file" pointing at a line four
above the actual cause.
