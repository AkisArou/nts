# The evidence belonged to the row below

Two ledger rows about generic classes, adjacent, each with a number:

```text
inferred rather than written    Twenty refusal sites in `runtime/node`, all of
                                them `AsyncLocalStorage<T>`,
                                `StorageContextEntry<T>` and
                                `AbortableAsyncSource<T>`

exported but not instantiated   129 refusal sites in `runtime/node`, one per
                                in its own compilation      member
```

Both numbers were wrong, and they were wrong in different ways.

## The first row's sites are the second row's

The construct the first row names **works**. A minimal pair says so: `new
Box(n)` with no type argument, `new Source([n], 3)` where `T` is inferred from
`T[]` rather than from a bare `T`, and an *exported* generic class instantiated
by inference all lower and agree with node across 116 cases, against a
written-out `new Box<number>(n)` control.

What still refuses is `AsyncLocalStorage` (10 sites) and `StorageContextEntry`
(4) in `async_hooks`. And **neither is instantiated in that module at all** —
there is no `new` of either anywhere in it. So what those sites lack is not an
inferred type argument. It is any instantiation to copy from, which is the row
underneath.

The sites were filed against the row whose **name fits the source text** rather
than the row whose **condition holds**. `new AbortableAsyncSource(source,
signal)` reads like "an instantiation that is inferred", and it is; it is also
in a module that never instantiates it, and only one of those two facts is what
the compiler is complaining about.

**A row with no reachable case cannot be falsified by its own fixture.** A
fixture written for the first row would instantiate the class by inference in
the same compilation — and pass, every time, for ever, because that is the case
that works. This is [[0296]] again with the cause one step further back: not a
fixture that cannot fail, but a *row* that cannot, because the evidence proving
it was never about it.

## The second row's 129 is 23

`refusal-census.mjs --top=204`:

```text
  5      23     12   a member of `X`, a class this compiler has no type for
```

Five distinct classes, twenty-three sites, twelve modules. The row said 129,
"one per member" — which is the arithmetic of members-times-classes rather than
a count of anything the compiler printed.

**The `--top=` is load-bearing and is a change made an hour earlier**, because
the table prints 25 of 204 roots and said so nowhere. Without it this number is
not reachable at all: the row sits well below the cut.

## What the two have in common

Neither number came from running anything recently, and both were plausible.
Twenty sites in three named classes is a specific-sounding claim. "129, one per
member" carries its own derivation, which is what makes it feel checked — and
the derivation is the problem: it is a *calculation* standing where a
measurement should be, and a calculation cannot go stale, so nothing about it
ever looks old.

That is the third distinct way a figure has gone wrong in this file tonight,
after a stale count that printed on every gate run ([[0317]]) and a ranked list
read as a set ([[0319]]). This one is a number that was never measured at all.
