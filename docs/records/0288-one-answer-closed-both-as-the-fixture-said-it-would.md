# One answer closed both, as the fixture said it would

`blockers/call-and-apply-on-a-function-value` carried this sentence for a day
before either half was built:

> `fn` here is `(x: number) => number`, which takes its argument
> **positionally**, so the literal's arity would have to be spread across
> parameters. That is the same question as a fixed-arity rest, from the other
> side: there a fixed-arity rest has to become positional parameters, and here a
> literal has to become positional arguments. **One answer will close both.**

It was right, and the second half cost about thirty lines once record `0287`
was in. This record is mostly about what that prediction was worth, because it
is the cheapest thing in this directory and the easiest not to write down.

## What `.apply` needed

Two ways an arity can be known, and **both** are needed — which is the part a
type-only rule gets wrong.

A **literal** carries its arity syntactically. Asking the checker instead
answers nothing useful: `fn.apply(undefined, [x])` against `(x: number) =>
number` widens the literal to `number[]`, which has no arity at all. A rule that
only read types would have refused the commonest spelling there is.

A **value** carries its arity only when its type is a tuple. That is
`fn.apply(thisArg, args)` with `fn: (...args: A) => T`, which is how all twelve
`.apply` sites in `runtime/node` are written.

The second one became load-bearing in a way nobody planned: after `0287` a rest
typed by a fixed-length tuple **is not a rest any more** by the time
`parameter_shapes` is asked, so those twelve sites stopped taking the array
branch and started arriving at the positional one. The change that opened the
new path is the same change that moved the old traffic onto it. Had the
positional case not been built in the same commit, `0287` would have taken
`.apply` backwards at every site in the tree.

That is worth stating as a rule: **when a predicate stops being true of a
construct, find who was branching on it.** `parameter_shapes(...).position(|(_,
rest)| *rest)` was a question with a different answer after `0287`, and nothing
about the diff said so.

## What it produces

    export func viaApply(fn: managed<obj#4>, x: f64) -> f64 {
      %2 = call.closure[0] %0(%0, %1) : f64

The same call `.call` emits. No array is built, which is the whole point: the
array in `f.apply(r, [a, b])` is notation, not data.

## The remainder, from two directions

`blockers/call-and-apply-on-a-function-value` and
`blockers/a-spread-into-a-call` now hold **the same remainder** reached from
opposite sides: an array whose length exists only at run time, against a callee
whose parameter list is fixed.

    fn.apply(undefined, xs)   xs: number[]
    add(...xs)                xs: number[]

Both have the same two non-answers — a calling convention with a run-time
argument count, which no backend here has, or a length check and a throw on a
path nothing has proved unsafe. And TypeScript rejects both, which is the
strongest argument that refusing is right rather than a gap: no correct program
is being turned away. They stay filed so the *message* stays accurate.

`examples/an-apply-whose-list-has-an-arity` guards four shapes and two controls,
one of which is `.call` — if those two ever disagree it is the receiver that has
drifted, not the arguments.
