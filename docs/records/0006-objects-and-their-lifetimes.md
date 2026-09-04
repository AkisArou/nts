# Objects and their lifetimes: what counting costs, and what it saves

Reference counting (RFC §9.2) exists so that a program which allocates can run
for longer than its memory. This records what it actually cost to add, what had
to be removed again before it was worth having, and the measurement that
mattered more than any of it.

## The measurement

`objects` allocates 4096 short-lived two-field objects, reads each once, and
drops it. It is the only case in `benches/` that allocates at all.

| variant | ns per call | against C |
| --- | --- | --- |
| nts, NoGC (bump allocator) | 66.0 us | 31x slower |
| nts, reference counting | 21.8 us | 10x slower |
| nts, escape analysis | **2.1 us** | **parity** |
| C (double), by hand | 2.1 us | — |
| node 24 | 2.2 us | — |

Three things are in that table.

**Freeing is a locality optimization before it is a memory one.** RC beats the
bump allocator by three times on a workload neither of them runs out of memory
on. The bump allocator walks two hundred kilobytes of fresh memory per call and
never comes back to it; RC hands the same block out again and it stays in L1.

**Ten times was not the counting.** With counting fully elided the program was
still ten times off hand-written C, because the allocation was still there.

**The allocation was the whole gap.** clang deletes a `malloc`/`free` pair whose
result does not escape, and V8 scalar-replaces the object outright. Both read
the same fact off the same program. Once nts reads it too, the three columns
agree — and the arithmetic in the loop body, three operations, is finally what
the benchmark measures.

## What counting costs when it is done naively

The first working version emitted, for the `instances` example, four retains and
nineteen releases. The correct-by-construction convention — every value is owned
by the function that names it, every consumption takes its own reference — gives
local rules and a great many redundant pairs.

Five removals took it to no retains at all and one release per allocation:

- **Parameters are borrowed.** The caller holds a reference across a synchronous
  call and cannot release it until after the call returns, so the callee needs
  none of its own. This is the one rule here that rests on an argument about the
  caller rather than something local.
- **Constructors return nothing.** Returning the instance handed the caller a
  second reference to an object it had just allocated and already named.
- **Handing a reference on is a move.** A value transferred and dying at the
  same point gives the consumer the reference it was already holding. Without
  this, every loop-carried object touches the count on every back edge.
- **Initializing stores.** A store into a slot that is still zero owes no load
  and no release. Almost every store in a program is one.
- **Borrowed loads.** A reference read out of a slot belongs to that slot, and
  across a stretch with no call, no store and no release, the slot cannot change
  and the container cannot go away. `Box#read` went from a retain, two loads and
  a release to two loads.

## What is still owed

**Cycles.** A cycle is precisely what never reaches zero, so it leaks. §9.2's
cycle collector is not written.

**Frame objects that hold references.** Only objects of scalars go in the frame
today, because one holding a reference would need that released where the frame
ends and a frame slot has nowhere to hang it. The extension is to emit those
releases at the end of the live range — what the runtime does when it destroys a
heap object, done by the compiler instead.

**Loads that could borrow.** Reading a reference field retains and releases.
Where the container is provably alive across the whole use — a field chain with
no intervening call — neither is needed. This is the same argument that makes
parameters borrowed, applied one level down.

**Constructors that branch.** The initializing-store analysis is block-local,
so a constructor writing a field from inside an `if` pays the general cost.
Fixing it is a forward dataflow with union at joins. Being wrong here does not
fail loudly, which is why the version that can be read and believed came first.

## The bugs worth remembering

**Counting is not memory.** `nts_release` at zero set a flag and bumped a
counter; it did not free, because the bump allocator cannot. The balance test
passed while the heap grew. `nts_live_bytes` is now what the tests assert on,
because counts balancing is bookkeeping and bytes returning is the claim.

**A live range can end on an edge rather than in a block.** Block-granularity
liveness takes the union over successors, so a value live along one arm and dead
along the other looks live out of the branch and is released down neither path.
Releases go on edges, with the edge split when it needs to carry any.

**`used ∪ (live_out \ defined)` is not liveness.** The subtraction has to cover
`used` as well — "upward-exposed uses". A value defined in a block and read by
that block's own terminator, which every loop-carried value is, was reported
live on entry to its own loop and therefore *available* at a header where it is
not yet defined. It surfaced as a release the SSA verifier rejected, a long way
from the mistake.

**`readonly` as `const` was undefined the moment objects moved to the frame.**
The construction store cast the qualifier away, which is defined for heap
storage — no declared type — and not for a struct declared in a frame. The fact
is better kept in the HIR, where a load that cannot change is something this
compiler can common up itself.
