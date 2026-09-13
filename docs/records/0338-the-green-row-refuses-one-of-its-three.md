# The green row refuses one of the three things it names

Row 111 reads `?.`, `?.()`, `?.[]` and is marked ✅. One of the three refuses,
and it is the one with the most demand.

## Found by walking, not by reading

`prize.mjs` says `createServer` alone appears in **369** of the 1934 files the
compiled lane could gain. Walking it:

```text
  createServer        -> Server#constructor, refused above
  Server#close        -> nextTick<obj2675x0>, refused above
  Server#createAccepted -> Socket#constructor, refused above
```

and past the NTS1003 cascades to `net`'s actual roots:

```text
  114  assigning to this property
   63  a property `value` of unrepresentable type (a union of `closeSentinel` …)
   58  a property `sourceSignals` of unrepresentable type (an array of `WeakRef`)
   55  a call inside a `try`, whose `throw` would not reach this handler
   49  `null` or `undefined` where what it stands in for is not a reference
   42  an optional-chained method call (`a?.b()`)
```

The last one is a **language feature the ledger calls green**.

## The two spellings are different nodes

```ts
h.t?.step(n)      // refuses: an optional-chained method call (`a?.b()`)
w.step?.(n)       // lowers -- row 162, a function-valued property called optionally
```

Both arms in one file, and the first version of that probe was useless: arm B
refused too, with `a call of a function value in a program with no closures`,
which is an artefact of a probe containing no closure rather than anything about
`?.`. One unrelated arrow function later, arm B is green and the two shapes
separate cleanly.

The cause is exact. `lower_method_call` destructures its callee as
`[receiver, member]`; an optional-chained member access has **three** children,
because the `?.` is a token of its own between them. So the shape falls through
to a refusal that already names itself correctly — the diagnostic was written by
someone who had met it.

## Two numbers, two units

    76 distinct source sites across 24 files   (grep over runtime/node)
    241 refusal instances across five modules  (net 42, http 56, stream 50,
                                                fs 58, events 35)

Neither is the other. A site inside a function that is specialised N times
refuses N times, so the second counts instantiations and the first counts
program text. Quoting one as the other would overstate the work by 3x or
understate the yield by the same.

**Zero** of the 76 carry a second `?.` on the line, so none is the separately
refused `a link after an optional access`. One implementation covers all of them
— which is a fact I checked *before* proposing to build it, having spent the
previous hour reverting a representation justified by two files out of eleven.

## Why it is not built here

The machinery is beside it: `lower_optional_access` and the `Branch::Invoke` arm
already do `absence_of` → `present_of` → `lower_branching_value`, and this wants
the same three steps with a method call in the present arm. What it needs first
is `lower_method_call`'s 183 lines split so that arm can be handed a receiver
that is already lowered and unerased.

That is a mechanical refactor of a central dispatch function, and the honest
reason it is filed rather than done is the one this session has earned: it would
be starting a refactor of a function every module's calls pass through, in a tree
two other sessions are committing to, immediately after a revert. The row now
says what is true, what it costs, and where the machinery is, which is what makes
it the next thing rather than a rediscovery.
