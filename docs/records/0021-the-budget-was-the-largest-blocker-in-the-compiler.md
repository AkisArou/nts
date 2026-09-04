# 0021 — The budget was the largest blocker in the compiler

The node profile lowered 171 of its functions. Lifting one constant took it to
391, for about 3% more frontend time. Nothing about the compiler changed.

## What the constant was

`Budget::DEFAULT` bounded type decomposition at 4,096 distinct types. Its own
doc comment said what it was:

> Enough for a small program; a placeholder until reachability sets the seeds
> and the bound stops mattering.

Reachability had since started setting the seeds. The bound had not stopped
mattering, and nobody went back.

The profile has **7,459 distinct types**, so the walk stopped roughly two
thirds of the way through and left **3,859 of them as placeholders** — over
half the type graph. Every one of those became a refusal downstream, and the
refusal named whichever construct happened to mention the type:

| refusal | instances |
| --- | ---: |
| `a class of unrepresentable type (a structured type 0x100000)` | 160 |
| `a parameter of unrepresentable type (a structured type 0x100000)` | 106 |
| `a parameter of unrepresentable type (a structured type 0x8000000)` | 88 |

`0x100000` is `OBJECT` and `0x8000000` is `UNION`. Three hundred and fifty-four
refusals, all of them the same thing, none of them naming it.

## It was reported, and the report was not read

`NTS0002` already existed, and it is exactly right:

> the type graph is partial: decomposition stopped at its budget of 4096 types,
> so any refusal below may be a consequence of the truncation rather than of the
> construct it names

It fired on every compile of the profile. It says, in those words, that the
refusal list below it is not to be trusted — and the refusal list below it was
what every work-list for months was built from, including the ones in
`docs/records/0015` and `0019`. The warning was filtered out by the same `grep
NTS1001` that produced the histogram.

So the finding is not only about a constant. A diagnostic that invalidates the
rest of the output has to be impossible to filter out of it.

## The bound now follows the program

A constant is the wrong shape. The walk's job is the transitive closure of the
*reachable* types, and for a program that does not generate types that closure
is proportional to its seeds — so the bound is a multiple of the seed count,
with a floor for a program that has almost no types of its own.

What it is still protecting against is generation without end: `PromiseLike<T>`
has a `then` returning a `PromiseLike` of two fresh type parameters, whose
`then` returns another, forever. Every step is a genuinely new type, so `done`
never stops it — one module reached 2,022 type parameters and 1,011
instantiations before the cutoff.

The multiplication saturates, which is not a detail: a seed count large enough
to wrap it would hand the walk a *tiny* allowance and look exactly like the
truncation this replaced. There is a compile-time assertion for it.

## What it left behind

With the graph whole, the profile's top refusal became
`a property the type does not declare` at 133 — which turned out to be
private fields, and is written up in `0020`. Fixing that took it to **453**.

The remaining `Structured` placeholders are now the deliberate ones: the
library boundary that keeps `Promise<void>` and a class prototype from pulling
the standard library's whole graph in. `a base Uint8Array of unrepresentable
type` at 90 is the next of those, and it is a real question rather than an
oversight — this compiler represents typed arrays natively, so `Uint8Array`
belongs on the same list as `Array` and `Promise`, which cross the boundary
because what the lowering needs from them is not their members.
