# 0116 — C2 scalar-replaces it, so two planned changes are not needed

The plan named three measurements that decide designs, and called the first the
highest-value one in the lane: **does C2 scalar-replace what this backend
emits?** It has never been run. Here it is, `bytes/op` from
`getThreadAllocatedBytes` under `NTS_BENCH_ALLOC=1`, which is the instrument the
plan specifies because `-XX:+PrintEscapeAnalysis` is debug-VM-only and does not
exist on a stock JDK.

    case                     bytes/op   jvm/Java
    objects                      0.00      1.03x
    erasure-unknown              0.00      1.00x
    user-iterable                0.00      7.55x
    erasure-stored-unknown   16016.00      0.96x
    map-and-set              65952.00      2.19x
    optional-chain         1600000.00      3.43x

## Two planned changes are now not worth building

**The scalarised `Erased`.** The plan reserved a decomposed representation --
an erased local becoming three slots, an erased parameter three parameters -- on
the argument that a boxed `NtsValue` allocates unless C2 removes it, and noted
that JDK 21 has no `ReduceAllocationMerges` so an object merged at a
control-flow join is not scalar-replaced at all. **`erasure-unknown` is 0.00
bytes/op and 1.00x.** The box is free where it does not escape, which is the
case the decomposition was for. The stored case is 16 KB/op and cannot be
scalar-replaced by anything -- it is an array of them -- and it is **0.96x**,
which is this lane winning.

The condition the plan set was explicit: *"If replaced in the two non-stored
cases, do not build the scalarising path."* It is replaced. Do not build it.

**Inlining the constructor into `<init>`.** Reserved to buy `ACC_FINAL` on
`readonly` fields, at the cost of the verifier's `uninitializedThis` state --
"the single most error-prone region of the spec" -- and gated on whether
`benches/cases/objects` showed the JIT caring. **`objects` is 0.00 bytes/op and
1.03x.** There is no allocation to remove. The remaining 3% is not an
allocation and the change would not address it.

## The one that is not free, and it is not the one anybody expected

**`optional-chain` allocates 1.6 MB per operation** -- 100,000 iterations times
sixteen bytes, so one `Held` per iteration, none of them removed. It is 3.43x
and the only row in the suite where allocation is demonstrably the cost.

That is the shape the plan predicted for `Erased` and did not predict here: a
short-lived object, built in a loop, read once. The obvious difference from
`objects`, which *is* replaced, is that `Held` carries an erased field written
on one arm of a branch and read after the join -- which is exactly the merge
JDK 21 cannot reduce. **Predicted before checking**, so it is refutable: if the
allocation survives because of the branch, hoisting the object out of the
conditional should take it to zero, and if it does not, the cause is something
else.

## And one hypothesis this refutes outright

`user-iterable` is 7.55x and **0.00 bytes/op**. JavaScript's iterator protocol
returns a fresh `{ value, done }` per step, so the row was expected to be about
allocation on both sides -- my own `ref.java` says so in its comment, and the C
lane's 21.4x against C++ makes it look obvious. C2 removes every one of them.
Whatever costs 7.55x there, it is not the object.

That is the value of running the measurement the plan asked for rather than the
one the row suggests: three rows had a story about allocation and only one of
them was true.
