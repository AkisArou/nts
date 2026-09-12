# Thirty-seven refusals cleared, and the answer was wrong

With the census's number one row split ([0309](0309-the-row-could-not-be-ranked-while-it-was-one-sentence.md)),
its largest real component was intersections: a value narrowed twice has an
intersection type, and `representation_of` had no arm for one at all.

Instrumenting the diagnostic showed what those intersections are, and it looked
like a gift. Every one in `util` but a single case:

```
`on`      on an intersection [<anon>=Erased & <anon>=Object(7801)]
`href`    on an intersection [<anon>=Erased & <anon>=Object(11310)]
`aborted` on an intersection [Object(6740) & Object(6799)]
```

One member erased, one concrete. So the rule writes itself: an intersection is
one value with several facts known about it, not several values; `object` and
`unknown` are the *absence* of a constraint; take whichever member has a
concrete representation, and refuse only when two concrete members disagree.
Twenty lines, and:

```
util     intersection refusals   12 -> 1
stream   intersection refusals   25 -> 1
```

## The fixture that could not fail

Before measuring that I wrote a probe: `Sized & object`, narrowed twice, read a
field. Four exports, 116 cases, agreed on every one.

It also agreed on every one **with the compiler from before the change**. The
shape I invented did not produce a `TypeKind::Intersection` at all, so the
fixture exercised nothing and would have passed whatever I did. Running it
against the previous binary took one command and is the only reason I did not
stop there.

## What the corpus shape actually was

Reading the real sites rather than inventing one:

```ts
if (typeof value === "object" && "href" in value && typeof value.href === "string")
```

`"href" in value` narrows to `object & { href: unknown }`, and the concrete
member is **a synthetic record the checker built from the key name**. Its layout
has `href` at index zero. The value is any object that has an `href` at all, at
whatever offset its own class put it there.

A class with two fields ahead of `href`:

```
nts   inNarrowing 0   bff0000000000000     (-1)
node  inNarrowing 0   0000000000000000     (0)
```

29 of 29 cases. A refusal had become a wrong answer that runs.

## The sentence I already owned

**`in` answers whether a property exists, not where it is.**

This compiler has paid for that sentence once already, and I am the one who paid:
the presence-bit work earlier the same day exists *because* a layout lookup
cannot answer `"x" in o`. I wrote twenty lines assuming the opposite one level
up, and the thing that caught it was not the knowledge — it was a program with
the field in third place.

## The two costs, and which was nearly paid

The refusal count is the one that lied. 37 to 2 is the largest single drop any
change made this session and it was entirely wrong, because **a refusal count
cannot tell a refusal that was unnecessary from one that was protecting you.**
The ledger's own note says a refusal count and a lowered count are different
currencies; this adds a third: a refusal count and a *correct answer* count are
different currencies too, and the first moves first.

What a correct version needs is a narrowing that establishes a **layout** rather
than a property. `v instanceof C` does and already lowers; a predicate returning
`v is C` for a declared class does. A structural refinement over a receiver
whose class is unknown cannot — and that is what all 37 sites are. So the fix
is not a better representation rule, it is a different narrowing, and the 37
were never available.

`blockers/an-intersection-from-an-in-narrowing` holds the program, with the
`instanceof` control beside it, so the next person to find this tempting meets
the counterexample instead of the measurement.
