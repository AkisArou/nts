# 0201 — An interface method is a dispatch root

    sink.write(value)

    NTS1001 a method `write` with no declaration in the hierarchy

739 occurrences across the node corpus, 52 more in the web-platform one, and the
most frequent single shape in two other lanes' inventories — `close`, `dispatch`,
`parse`, `digest`, all called on a field whose declared type is an interface.

The hierarchy is read from **class declarations** and walks a single `base`
edge. An interface was not in it at all, so a receiver typed as one had no
declaration to find.

The fix is one sentence: a method on an interface is a **dispatch root**. Every
implementer must be reachable through it, which is exactly what a slot is. The
slot is numbered against the interface, each class fills it, and the interface
gets an [`Func::abstract_declaration`] to name at the call site — the same thing
a function type gets for its `call`, and the same reason.

Closed 1,010 refusals in `runtime/node` and 52 in `runtime/web-platform`,
measured with one binary on each side of the change over one corpus.

## `base_types` does not carry `implements`

Its documentation says it does:

> Base types of a class or interface type, in declaration order. `extends`
> first, then `implements`.

For `class Counting implements Sink` there is no entry at all. Not an empty
list, not the interface — nothing.

I built the `implements` edge on that sentence, the slot did not appear, and it
took dumping the hierarchy to find out why. The edge now comes from the heritage
clause. **And not by reading the `extends`/`implements` keyword**: it asks
whether the target is a known interface, which is a question the compiler has
already answered, rather than the question the token spells. One fewer thing to
keep agreeing with the parser.

## Two classes with one shape were one layout

`Counting` and `Doubling` both had `total: number`. `same_shape` compares fields
*and* methods, and before the slot existed **both method tables were empty** —
so they merged into one layout holding two type ids, and the dispatch had
nothing left to choose between.

The slot is what separates them. Which means the example's two implementers have
deliberately different fields: a version where they differ only in behaviour
would pass against a compiler that merged them, and would have passed against
this one an hour earlier.

That is the fourth time in two days that an *empty* thing merged with another
empty thing and the merge was invisible until something needed them apart.

## A function of mine, deleted after sabotaging it

I wrote an `interface_declaring` walk — find the highest interface at or above a
type declaring the member, so the slot is numbered against the thing every
implementer shares. It reads as obviously necessary.

Sabotaging it to return nothing left **every case agreeing**, including
`throughAnExtendedInterface`, which was written specifically to reach it: a
class that both extends a class and implements an interface that extends
another.

It is unnecessary, and the reason is structural. The slot loop iterates
`hierarchy.declares`, and interfaces are *in* `declares` — so the interface is
asked about **itself**, and `root_declaring(Sink, "write")` answers `Sink`
without anything walking up to it. The walk was a second route to an answer one
route already gives.

A second route that agrees is not free. It is a thing to keep agreeing, and the
next person to change the first route has no way to know the second exists.

## What the sabotages of the real mechanism show, which is not a wrong answer

    the `implements` edge removed from `descends_from`   three of seven functions stop compiling
    every implementer's slot filled with one impl       the backend refuses on receiver types

Neither produces a wrong number. On this lane the dispatch is guarded by the
type system and by whether the program builds at all.

**And I assumed the checked-cast backend covered the rest. It does not, for
interfaces.** I wrote that a wrong cast through a correct-looking table is
"exactly what that lane sees", and the JVM session corrected it: JVMS 4.10.1.2
makes any class type assignable to any interface type **without checking**. The
verifier does not look. The check is deferred to `invokeinterface`, which raises
`IncompatibleClassChangeError` when the receiver does not implement — at run
time, and only on a path something executes.

So that lane is a load-time instrument for the CLASS half of a hierarchy and a
*runtime* one for the interface half. A wrong interface edge on a path no case
exercises passes on both lanes.

That is the fourth instrument today to check less than its reputation, and the
first where the reputation was mine rather than its owner's: I reasoned from
"the checked-cast backend catches lies about types" to a specific case it does
not cover, and would have written it into this record as coverage.

## `Layout.interfaces`

The JVM backend needs the edge and cannot derive it. Its derivation would be "a
class fills every slot this root numbered", and slots are numbered per method
across the program — two unrelated roots sharing a method name share a slot, so
the derived edge is a guess that is usually right. Same shape as recovering
`base` by matching field prefixes, and rejected for the same reason.

Not folded into `base`, because a class extends one thing and implements many:
`class C extends B implements Sink` has nowhere to put the second edge. The
class file has the same split — `super_class` is one, `interfaces[]` is a list —
and needs it downstream, since `invokevirtual` and `invokeinterface` are
different instructions chosen by which kind of edge the declared type came from.

Transitively closed, because the JVM does not walk `interface A extends B` at a
call site. Sorted, because a hash-ordered list would make one input emit two
byte sequences and the jar-drift test would report it as a failure.

Every interface named in one is laid out, because a backend handed a type id
needs a layout to get a name from and an interface reached only as a local's
declared type had none. Measured: identical refusal counts with and without,
which is not obvious — forcing a layout earlier changes the order
`collect_layouts` merges in, and that cost a thousand refusals in a different
change this same day.

## What to take

The refusal said "no declaration in the hierarchy" and it was accurate: there
was none, because the hierarchy did not contain interfaces. A message that
describes the compiler's own data structure is true and sends the reader to look
for a missing declaration rather than a missing *kind of thing*.

And: sabotage the parts of a change separately. Three of the four things I built
here were load-bearing and the fourth was dead, and the only way that was
visible was breaking each one alone and watching what did not move.
