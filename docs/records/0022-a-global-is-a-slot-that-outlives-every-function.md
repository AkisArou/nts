# 0022 — A global is a slot that outlives every function

A module-scope variable holding a reference was refused, 73 times in the node
profile and third on the list. Allowing it turned out to be one sentence — a
global is a slot, like a field is — and two bugs that had to be fixed before
the sentence was true.

## The bugs, which were live before the feature

Neither needed the feature to be reachable: a module-scope `unknown` was
already allowed to hold a reference, which is what `can_be_global` said and
what `docs/any-unknown.md` asks for.

**A store to a global was not an escape.** `OpKind::GlobalSet` reached the
escape analysis's catch-all, so this compiled:

```c
NtsObj_Type6 v1_frame;
...
held = v3;              /* static NtsValue held */
```

`{ tag: n }` assigned to a module-scope variable was placed in the caller's
stack frame, and the static pointed at dead stack from the moment the function
returned. The comment above the `Suspend` arm, three lines below, already says
this happened once before: *"It reached this match's catch-all when the
operation was added... Nothing failed loudly."* Two operations, same hole. The
note was written and the class was not closed.

**Escaping did not follow through an erasure.** This is the half that made it
silent. Marking the erasure escaped leaves the object it *carries* looking
frame-local, because `Erase` is an operation like any other to that analysis.
An erased value is its payload as far as reachability goes — so the fix without
this one would have looked right and changed nothing.

## The feature is three edits, because a global is a slot

`hir::rc` already has the shape. Its convention is that a value read out of
somewhere that outlives the read is retained at its definition, and that every
consumption retains. A global is the strongest case of "outlives the read"
there is.

- `GlobalGet` joins `is_load`.
- `GlobalSet` joins the store arm.
- `load_slot` learns one case.

What that buys is everything already attached to those. The store order is
load-old, retain-new, store, release-old, so `held = held` is a no-op rather
than a use-after-free — for free, because it is the same code path a field
store takes. And `borrows_safely` elides the pair for a read used in
straight-line code, also for free.

## What typed code pays

Nothing, and it is worth showing rather than asserting.

A scalar global under `--rc` is byte-identical to before, because `counted`
asks the type and a `double` does not hold a reference:

```c
double tick(double v0) {
    v1 = counter;
    v2 = v1 + v0;
    counter = v2;
```

A *reference* global read and used immediately takes no reference either —
nothing between the read and the use can overwrite the slot, which is what
`borrows_safely` decides:

```c
double borrowed(double v0) {
    v1 = name;
    v2 = (double)v1->length;
```

Only a store, and only of a reference, pays anything.

## The cycle collector needs no root table

Counting the global's reference is what makes it safe, and that is the whole
of it. Trial deletion decrements the edges *inside* a candidate subgraph and
asks whether anything is left over; a global's reference is outside and now
counted, so an object a global holds never reaches zero and is never collected.

What is left is a leak rather than a crash: a cycle held only by a global is
never released, so it never becomes a candidate root and is never traced. That
is honest and it is bounded — module state is program-lifetime by nature.

## The measurement, including the part that got worse

The node profile: **470 lowered functions to 504**.

The TypeScript corpus: **49 files lowered completely to 44**. That number is
"files with no refusal at all", and allowing more means *attempting* more. A
module-scope variable that could not be a global was skipped in silence, and a
file full of them looked clean; now the initializer is lowered and can fail.
The five that moved fail on a `function` expression, a closure over an outer
scope, and a tuple property — each an honest refusal of something that was
previously not attempted.

Two smaller things fell out of it:

- The initializer of a module-scope declaration was found as "the last child
  that is not an identifier", so `let held: Box | undefined = undefined` meant
  the *type annotation* — which `module#init` then tried to lower as an
  expression — and `let x = y` was a declaration with no initializer at all. It
  is now the last child that is neither the name nor a type node, which is what
  `default_of` next to it already did.
- `[]` is typed `never[]`: the checker saying the literal decides nothing and
  the slot does. Inside a function the declaration supplies the real type;
  a module-scope initializer was lowered with nothing to ask, and an array of
  `never` reached code generation. It is lowered *expecting* the global's type
  now, which is what `lower_expecting` is for.
