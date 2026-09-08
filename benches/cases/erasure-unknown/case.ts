// What erasure costs, against `erasure-typed`, which is this program with
// `unknown` replaced by `number` and nothing else changed.
//
// The three shapes `nts erasure` sorts sites into, one per call:
//
//   widen    carried  -- goes in, comes out, nothing reads it
//   kindOf   tested   -- the tag is read and the payload is not
//   readBack examined -- narrowed, then the payload is read
//
// 41%, 14% and 31% of the `unknown` parameters in the node profile
// respectively, which is why these three and not some other three.
// # Measured on the JVM lane, 2026-09-08: C2 scalar-replaces every one
//
//     bytes/op   erasure-unknown  0.00      NtsValue references in bytecode: 5
//     bytes/op   erasure-typed    0.00      NtsValue references in bytecode: 0
//     jvm/Java   erasure-unknown  1.00x     134.30 us against 134.86 us
//
// Two hundred thousand erasures per operation, five `NtsValue` sites surviving
// into the class file, and **nothing allocated**. So the boxed representation
// ships and the scalarising path -- three slots per erased value, and three
// parameters where one was declared -- does not need building. That was the
// fork this pair existed to settle, and it is settled in the direction that
// costs no work.
//
// The instrument is `getThreadAllocatedBytes` and not
// `-XX:+PrintEscapeAnalysis`, which is `develop`-only and silently absent from
// every JDK anyone ships. It also answers the question more directly: escape
// analysis is a means, and what is wanted is whether the allocation happened.
//
// **One prediction is neither confirmed nor refuted, and it is worth saying
// which.** JDK 21 has no `ReduceAllocationMerges`, so an object *merged at a
// control-flow join* is not scalar-replaced at all, and the expectation was
// that `readBack`'s narrowing would be that shape. It is not: `readBack`
// receives an `NtsValue` that already exists and merges the `number` it reads
// out, so what joins is a double and no allocation is on either arm. A case
// that erases *inside* both arms of a branch and merges the results would be
// the shape that flag is about, and this pair does not contain one. Nothing
// here says what that would cost.

function widen(value: unknown): unknown {
  return value;
}

function kindOf(value: unknown): number {
  return typeof value === "number" ? 1 : 0;
}

function readBack(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function erasureUnknown(seed: number): number {
  let total = 0;
  for (let i = 0; i < 200000; i++) {
    const carried = widen(seed + i);
    total = total + kindOf(carried) + readBack(carried);
  }
  return total;
}

/**
 * The input the harness calls `erasureUnknown` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 12345;
