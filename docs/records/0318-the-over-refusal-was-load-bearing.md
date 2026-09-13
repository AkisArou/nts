# The over-refusal was load-bearing and its own note said it cost nothing

A closure over a `for` loop's own variable was refused. The ledger row said why,
and then said this:

> **The refusal is broader than its message and that costs nothing:**
> `is_per_iteration` walks from the declaration to the enclosing `for` without
> asking whether it is `let` or `var`, so a `var` loop — which JavaScript does
> *not* rebind, and whose capture this compiler already handles — is refused
> too. Measured before deciding: `runtime/node` has 7 `var` declarations and
> **all seven are `declare global { var X }` ambients**, with none in a loop.
> So the over-refusal is unreachable and the fix would be a change with no case
> behind it.

Every clause of that is true. The conclusion — that the breadth costs nothing —
was true only while the narrow part stayed refused.

## What the rule was actually asking

Whether the name is **written anywhere in the program**. A loop counter is
written by its own `i++`, in every `for` loop ever written, so the rule refused
every loop in order to catch the rare one.

The rare one is real:

```js
for (let i = 0; i < 3; i++) { fns.push(() => i); i += 10; }
```

The body's write lands in the binding the closure is already holding, so node
answers 10 for `fns[0]()` and a copy answers 0. The right question is whether
the **body** writes it, not whether anything does.

## Copying is exact, which is the part I expected to be a trade

The specification copies the binding *before* each iteration and runs the
increment in the copy, so iteration k's binding keeps iteration k's value for
ever. A closure built in the body and reading `i` must see that value — and the
value `i` holds where the closure is built **is** that value.

So capture-by-value is not a cheaper stand-in for a per-iteration cell on this
shape. It is the same answer, and it is node's.

## Then `var`

`var` has **one** binding for the whole loop. Every closure must see the value
the loop ended on: 3 where `let` gives 0. Narrowing the `let` rule to copy
without asking which keyword wrote the declaration would have turned a refusal
into a wrong answer that runs.

Nothing in the code said so. The sentence that would have warned me was in the
**ledger**, filed as a reason the over-refusal did not need fixing, and it is
what caught this — I was reading the row to update it, not to be warned by it.

**An over-refusal is a guard whose reason nobody has written down.** The note
recorded that it was broad and that the breadth was harmless; it did not record
that the breadth was the only thing standing between a second case and a wrong
answer, because at the time it was not. That fact came into being when the first
case was narrowed, and no instrument watches for a comment becoming load-bearing.

## The arm that could tell the answers apart, and the four that could not

My first probe had four arms and every one called its closure **immediately**:

```ts
run(() => { total += i; });
```

Under value capture and under a shared cell, an immediately-called closure sees
the same `i`. All four agreed with node under either implementation. The probe
could not fail at the thing it was for — which is [[0296]]'s sentence about a
fixture that cannot fail, arriving through a door I had not thought to watch.

`deferredOne` is the arm that earns it: the closure is called **after** the
loop, where value capture gives 0 and one shared cell gives 3.

The first attempt at that arm collected closures into an `Array<() => number>`
and declined at the backend — `an object type with no layout` — which would have
taken the whole example with it. One closure held in a variable is the same test
without the second gap.

## What it is worth, stated plainly

`refusal-census.mjs` over 26 modules: **zero sites**. This clears nothing in the
profile and moves no module. It was built because the standing queue named it
and asked whether the construct was silently wrong; it was not, and now the
common shape compiles and agrees with node on 116 cases where 29 were checked
before.

The same census says the object-literal method row — whose own cell reads "so it
is the next thing worth doing" — also has **zero sites**. Two rows in one
evening whose text argues for priority and whose corpus reach is nothing. A
sentence in a ledger is a hypothesis about what matters, exactly as the ledger's
own header says, and "worth doing" is the clause most likely to have been
written from the inside of the compiler rather than from the corpus.
