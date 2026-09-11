# An optional property has a third state

Calling a function held in a property worked. Calling one held in an *optional*
property did not, and the two differ by one character:

    run:  ((n: number) => number) | undefined     lowers
    run?: (n: number) => number                   `a method `run` with no
                                                   declaration in the hierarchy`

They are the same type as far as a reader is concerned, and TypeScript will
assign either to the other. They are not the same **slot**:

    run:  ((n) => number) | undefined   ->  managed<obj#4>
    run?: (n) => number                 ->  erased

A nullable reference is a pointer, because the one spare pointer value is what
`T | undefined` costs nothing to represent. An **optional property** has a third
state — *absent*, as against present-and-`undefined` — so a pointer cannot hold
it and it erases.

The call path asked for a closure object, did not get one, fell through to the
method lookup, and the hierarchy had nothing to declare. The message named
neither the optionality nor the field.

## What the diagnosis cost, and what it was worth

The Node lane walked `async_hooks`'s `emitInit` through five spellings and
concluded that "method syntax is what counts as a declaration" and a property
holding a function does not. That was the right reading of their five probes and
the wrong generalisation: a property holding a function **already worked**. Four
of my six probe shapes lowered on the first run.

What separated them was the `?`, and it was only visible with `run: F |
undefined` sitting beside `run?: F` in one file. Their probes varied the call
site — a cast, an extraction, a method-syntax rewrite — and never varied the
*modifier*, because there is no reason to think it matters until you see the two
slots printed next to each other.

**Their workaround is the tell in hindsight.** `const init = hook.init; init(…)`
compiled for them, and that is the same shape as my probe `c`, which lowered.
Extracting to a local narrows, and a narrowed local is a pointer.

## The licence, and why the representation cannot give it

`o.run(x)` only typechecks where the checker has narrowed `o.run` to the
function, so the narrowing is the licence to unerase. But the **representation
cannot say whether it happened**: `F` and `F | undefined` are both a pointer, so
a width test admits the un-narrowed case.

So the type is asked, not its width. Without that, `o.run!(x)` on an absent
property would unerase a tag that says absent and call through whatever the
payload bits are. Node throws `TypeError: o.run is not a function`; a null call
is not that, and it is the one outcome worse than the refusal being replaced.

    guarded by `=== undefined`     lowers
    guarded by truthiness          lowers
    an optional class field        lowers
    no guard at all                refuses, as before

## What it is under

`emitInit` compiles, and `async_hooks` has no `no declaration in the hierarchy`
refusals left. That message covers at least three unlike causes across 42 sites,
so this closes one of them rather than the count — the count is a count of
message texts.

The Node lane's ordering correction is the part to keep. `asRequest` has **two
independent blockers**, not two links: the concrete twin compiles once `emitInit`
is fixed, and the real generic one still refuses for the generic. Which appears
in the output is only which the compiler reports first. Three corrections about
one function in a day, all from the concrete-twin method, and all because *a
method that shows you a blocker says nothing about ordering* — "the next one" is
an assumption the output does not support.
