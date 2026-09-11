# Remove the dispatch rather than predict it

Passing a class where a **structural interface** is wanted is a pointer cast,
and it is only sound where the target's fields are the source's first fields:

    class Thing  { id: number; name: string }   name at offset 32
    interface Named { name: string }            name at offset 24

`readName(new Thing(1))` would load `id` — a `double` — as an `NtsString *`.
That was a **segfault** before it was a refusal, and swapping the two field
declarations was the entire difference between a correct program and a crash.

It is now a copy of the callee over the concrete type:

    func readName(v: managed<obj#1>) -> i32          the plain one
    func readName@0obj3(v: managed<obj#3>) -> i32    the copy

No cast, no dispatch, nothing to be wrong about. The plain one stays: a call that
passes the declared type still names it, so a structural copy is an **addition**
where a generic instantiation is a replacement.

## Why not the simpler design

Laying the interface out like its single implementor would make the cast a real
prefix and need no copies at all. Two measurements from the JVM lane killed it.

**A prefix buys that lane nothing.** It relates classes by *name*: `getfield
Counted.n` needs the object to *be* a `Counted`, and coinciding offsets are not a
relation. Their `examples/a-structural-cast-that-is-a-prefix` had been refusing
for exactly that reason while its own header said the layouts already agreed.

**And it needs a set nobody has.** Reordering is only safe with the *complete*
list of classes satisfying each interface. The counts available come from refusal
sites, so a second implementor whose layout happens to be a prefix already works
and is invisible — reordering would break it. As that lane put it: a backend
cannot answer the question, because the classes that work by accident are exactly
the ones producing no layout evidence.

## The measurement that changed the reason

Every site was measured first: **63 distinct sites, 63 distinct (site, arriving
type) pairs — every one monomorphic.** On HotSpot that means an interface and a
copy are both on the top row and dispatch cost decides nothing.

Then the same curve on ART, which is the runtime that lane exists for:

    HotSpot                        ART
    field read  1092               field read  1085
    1 impl      1141   1.04x       1 impl      2134   1.97x
    2 impls     1319   1.21x       2 impls     2116   1.95x
    3 impls     3703   3.39x       3 impls     2045   1.89x

**There is no inline cache, so there is no top row.** C2 does not hide this cost,
it *inverts the shape of the curve* — flat against cliffed is a different
function, and the cheapest point on one is the most expensive relative to the
other.

So specialisation is not "make dispatch predictable", which is worth nothing at a
site already monomorphic. It is **remove dispatch**, worth about half the call
where it matters.

## Two things the build found that reading did not

**Substituting the type is wrong.** The first attempt bound the interface's
`TypeId` in a `Substitution`, which is what a generic copy does with a type
parameter. A type parameter is only ever inhabited by what it was substituted
with; an interface is an ordinary type, and other values of it live in the same
function — so `const other: Named = somethingElse` became a `Thing` too. **Seven
of twenty-four addons stopped building**, with refusals like ``null` or
`undefined` where what it stands in for is not a reference` naming a consequence
several steps from the cause.

The override belongs on the **parameter**, by position. That is exactly as much
as the copy changes, and it removed the need to widen `representation_of` at all.

**A guard inherited from a call is not a guard.** Skipping prefixes had been
carrying `laid_out_as_a_prefix`'s opening test — *a closure or a signature is not
a field-layout question* — by accident. Specialising prefixes removed the cover
and `blockers/callback-binding` regressed at once: a `declare function` taking a
callback got a copy and its prototype stopped being `void
nts_take_callback(NtsHeader *)`. The test has to be its own, where the question
is asked.

## Prefixes are specialised too, which is not obvious

On C and LLVM a prefix cast is already a no-op, so a copy buys nothing. It is
specialised anyway, because it is what closes the JVM's long-standing gap — a
copy over `Prefixed` takes a `Prefixed` and there is no cast to relate anything.
One more function on a lane where a copy is a static method and the constant pool
has two orders of magnitude spare.

## What is left, and the worse half of it

`blockers/a-structural-cast-that-is-not-a-prefix` keeps two shapes. An array of
the interface type **refuses**, by name.

A **field** of the interface type does not, and **segfaults**. `class Holder {
held: Named }` storing a `Thing` lowers, emits, builds and dies with signal 11 —
confirmed pre-existing under the pinned compiler at `a2a499b4`. `coerce` asks
`laid_out_as_a_prefix` on the way into a parameter and the field store does not,
so the guard that made one safe was never asked about the other. That wants the
refusal first, which turns a crash into a message.

## Not transitive, and what that does to the counts

A copy's own body can create a mismatch the pass never saw:

    function describe(v: Named) { return readName(v) * 2 }
    describe(new Thing(n))

`describe` is specialised over `Thing`. Inside that copy, `v` **is** a `Thing`
and `readName` still declares `Named` — a new site, created by the copy, that the
pass could not have read from the source, where `v` is declared `Named`.

Closing it is a fixpoint: a copy that re-types parameter `i` makes every call
inside the callee that forwards that parameter want a copy too, until nothing new
appears. Not attempted; the direct case is what the profile's 63 sites are.

**And it is why the site count for this refusal went up.**

    sites      fs 69 -> 83   http 53 -> 56   net 48 -> 46   stream 46 -> 48
    functions  fs 1615 -> 1615               net 1385 -> 1385

Copies add bodies, and a body that needs a copy of its own is a new site — so the
count rose while the thing it is a proxy for did not move at all. `fs` gains 111
copies and emits exactly as many functions as before, because a copy **replaces**
the plain version wherever every call to it was specialised.

That is the unit trap from `0289`'s neighbourhood arriving inside a single
change: the number that was easy to read moved the wrong way, and the number the
work is about did not move. Twenty-four of twenty-four addons build with none
regressed, which is the measurement that settles it.
