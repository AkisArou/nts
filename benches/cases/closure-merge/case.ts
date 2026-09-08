// Two closures reaching one call site, which is the shape that could not be
// compiled at all until 2026-09-08 and was a wrong answer on the native lanes
// before that.
//
// `closures` measures a closure whose class the call site knows: made once,
// `final`, so the body is known and the call is direct. This is the other
// half. `mix` holds one of two classes depending on the round, so the call
// below sees both and cannot be devirtualised to either -- which is exactly
// what `devirtualize_closures` used to do anyway, taking one arm's body and
// deleting the other's.
//
// So this is the row that says what representing the merge honestly costs. It
// should not be free: a direct call becomes a virtual one through the
// signature's abstract base. What it should *not* be is proportional to the
// number of arms, because the call site is bimorphic and every engine here has
// something to say about that -- C2 guards two direct calls, V8 keeps a
// two-entry inline cache, and clang has neither unless it can prove the set.
//
// The arithmetic is int-exact in every lane, by the argument `closures` makes:
// for `x < 512` the true product is far under 2^53 and exact in a double, so
// `ToInt32` of it is the product modulo 2^32, which is what an `int` multiply
// computes directly. `x >>> n` is `>>>` on both sides for non-negative `x`.
// Two different constants and two different shifts, so the arms are genuinely
// different code rather than one function the optimiser can merge back.

function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) {
    total = (total ^ f(i)) | 0;
  }
  return total;
}

export function work(seed: number): number {
  const step = seed | 0;
  let total = 0;
  for (let round = 0; round < 8; round++) {
    // The merge itself. Written as `if`/`else` rather than a conditional
    // because `lower_if` is the merge site the miscompilation lived in.
    let mix: (x: number) => number;
    if ((round & 1) === 0) {
      mix = (x: number): number => (((x * 2654435761) ^ (x >>> 3)) + step) | 0;
    } else {
      mix = (x: number): number => (((x * 40503) ^ (x >>> 5)) - step) | 0;
    }

    // Called where the merge is visible, then handed to something that knows
    // only the signature -- the same pair `closures` makes, so the two rows
    // differ in the merge and nothing else.
    for (let i = 0; i < 512; i++) {
      total = (total ^ mix(i)) | 0;
    }
    total = (total + drive(mix, 512)) | 0;
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * `volatile` in every generated driver: a loop-invariant argument lets the
 * optimiser hoist the whole call out of the timed region and report zero.
 */
export const seed = 5;
