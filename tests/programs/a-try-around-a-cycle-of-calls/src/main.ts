// A `try` whose callee chain has a cycle in it.
//
// The refusal names the leaf it reaches by walking down the declarations. The
// first version of that walk **overflowed the stack** on the React lane's
// reconciler, at about 38,760 frames: it had a depth counter, and it asked
// `why_no_raising_copy` for each call it passed, which rebuilt the sentence by
// calling back into the walk with the depth reset to zero. A bound has to sit on
// **every** edge of the cycle it bounds, and the cheapest way to be sure of that
// is for the walk to have one entry point -- `reason_without_a_leaf`, which never
// recurses.
//
// So this fixture is a cycle. `ping` and `pong` call each other, and the leaf --
// a method, which has no raising copy -- sits below the recursion's base case.
// Without the visited set it does not terminate; without the split it does not
// terminate either, whatever the depth counter says.

class Instance {
  lifecycle(n: number): number {
    if (n < 0) throw new Error("lifecycle failed");
    return n + 1;
  }
}

const shared = new Instance();

function ping(n: number): number {
  if (n <= 0) return shared.lifecycle(n);
  return pong(n - 1);
}

function pong(n: number): number {
  return ping(n - 1);
}

/**
 * Refused, and the refusal names `shared.lifecycle` through the cycle. The
 * program's value is that it **compiles at all** -- the walk terminating is what
 * this example is for, and a refusal that arrives is the evidence.
 */
export function throughACycle(n: number): number {
  try {
    return ping(n & 7);
  } catch {
    return -1;
  }
}

/**
 * The control: the same cycle with nothing that can raise below it, so the `try`
 * is not refused and the function compiles and runs. Without it, an example
 * whose only assertion is "a refusal arrived" would pass on a compiler that
 * refused everything.
 */
export function aCycleThatCannotThrow(n: number): number {
  // Masked, because the differential feeds a pool that includes 2^31: a mutual
  // recursion counting down from one of those asks for a billion frames and the
  // program does what it asks. The cycle is the point, not the trip count.
  return counting(n & 7) + 1;
}

function counting(n: number): number {
  return n <= 0 ? 0 : countingAgain(n - 1);
}

function countingAgain(n: number): number {
  return n <= 0 ? 0 : counting(n - 1);
}
