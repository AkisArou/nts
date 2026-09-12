# Agreed on every case, and wrong

`for await (const v of [1, 2])` is legal JavaScript and does not mean
`for (const v of [1, 2])`. It awaits **each element**, so the loop yields to the
microtask queue once per iteration even when nothing in it is a promise.

When `for await` started lowering, this fell out for free and I checked it:

```
checked 116 cases across 4 function(s)
agreed on every case
```

Four arms — an array, a synchronous generator, two yields, nested async
generators — every one agreeing with node. I nearly wrote it down as four
features instead of two.

## What the fixture could not see

The loop sums `[1, 2]`. So does node's. **The elements are identical, their
order is identical, and the sum is identical**; the only difference is *when
other work runs*. A fixture that reads the loop's value is asking a question
whose answer is the same on both sides of the defect.

Recording the **order** instead, against a second async function queued before
the loop:

```
                          nts    node
for await over an array   129    912
for await over a sync gen 129    912
for...of (control)        129    129
for await over an async generator (control)  agreed
```

`912` is node running the queued work *before the first element* — its loop
suspends before reading anything. Ours ran the whole loop and then the other
work. Two controls in the same file agree, which is what makes this a statement
about `for await` rather than about the harness.

It is refused by name now. The elements would have been right and the
interleaving wrong, which is the shape of defect this compiler is least able to
find later: nothing downstream checks an interleaving, and the row would have
read ✅ with 116 agreeing cases behind it.

## The part that generalises

The project already knows that [a fixture needs two
controls](../../docs/records) and that a refusal can make a fixture measure less
than it claims. This is the third thing: **a fixture can exercise the right
construct, agree on every case, and still be blind — because the observable it
reads is not the one the feature is about.**

The tell is available before running anything. Ask what the feature *is*: `for
await`'s whole content is "suspend between elements". A fixture reading the sum
is not reading suspension at all. When the feature is about **timing, ordering,
or how many times something ran**, the value is the wrong observable, and the
fixture has to count or sequence instead.

That is not a new technique here — `examples/assignment-through-an-accessor`
reports how many times each accessor ran, and `examples/void-and-comma` counts a
side effect, both for exactly this reason. What was new is that the blind
fixture *passed*, so nothing asked for the counting version. The accessor and
comma fixtures were written that way because someone predicted the blindness
first.

So the check to run is: **if this feature were not implemented at all and the
walk fell back to the obvious thing, would this fixture still pass?** For the
sum it would. That question is cheap, it needs no second implementation, and it
is the one I did not ask until the feature next door forced it.

`examples/an-async-generator` now carries a `stepOrder` export for the case that
does work, on the same argument: every other arm in it would give the same sum
if a step never suspended.
