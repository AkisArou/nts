# 0140 — Same cache misses, half the IPC, and the chase is the difference

`array-from` is **2.43x** hand-written Java and it is the row written to ask
whether generality cost anything: its own comment says *"an array source is the
one that had a fast path -- a `slice`, which is a memcpy. The walk-and-append
that replaced it is the general answer, and this row is what says whether
generality cost anything."*

It cost 2.43x, and the reason is not what the allocation says.

## Not the box, and not the misses

    nts (JVM)   8,280,888 bytes/op    IPC 2.05    35,850,318 cache misses
    Java        4,176,848 bytes/op    IPC 5.19    41,238,588 cache misses

The 1.98x on bytes is element width -- `double[]` against `int[]` -- and priced
separately at **1.24x** by mutating the reference. It is not 2.43x of anything.

**We take fewer cache misses than the reference and run at 40% of its IPC.**
That is the shape of a dependent chain: the misses are not more numerous, they
are serialised.

## Where the chase is

    invokestatic  NtsMap.keyAt:(Lnts/rt/NtsMap;D)Lnts/rt/NtsValue;
    getfield      NtsValue.num:D
    invokestatic  NtsArrayD.set:(Lnts/rt/NtsArrayD;DD)V

Two dependent loads per element -- a reference out of `NtsValue[] keys`, then a
field out of the object it points at, whose address is not known until the first
load returns. `keyAt` is 38.45% of the row for six operations, which is what a
stall looks like when it is attributed to the frame it lands in.

The reference walks `HashMap`'s table once in `toArray` and copies with
`Arrays.copyOf`, an intrinsic that becomes a bulk move.

## Why this is not a `runtime/jvm` fix

Two things would close it and neither is here:

**`Array.from` over an array should be a bulk copy.** Ours lowers to a
walk-and-append: `NtsArrayD.set` per element, 12.47% of the row, against one
`Arrays.copyOf`. Recognising that a loop copies an array into an array is loop
idiom recognition, and the fast path this replaced lived in the lowering.

**A set of numbers should not store `NtsValue`.** `keyAt` returns a boxed value
the caller immediately unboxes with `getfield num`; a `double[]` would make it
one load and remove the chase. But the map ABI is erased -- `nts_map_key_at`
takes and returns erased values by `hir::runtime`'s table -- so the backend
cannot know the keys are numbers, which is `HirType::Erased` dropping its arms
again, the sixth instance this week.

## The measurement worth keeping

I have twice today read a large percentage in a small function as a cost. On
`NtsMap.hash` it was arithmetic off the critical path at IPC 3.8 and removing it
was worth nothing. Here it is a stall at IPC 2.05 and removing it would be worth
a great deal -- and **the profile looks the same in both cases**.

IPC separates them, and it costs one `perf stat`. A frame at high IPC is issuing;
a frame at 2.05 against a reference at 5.19 is waiting. That is the check I will
run before believing a profile again.
