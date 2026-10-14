// `f?.(x)` in a hot loop, taking both paths.
//
// An optional call is a branch and an indirect call through the closure. The
// argument is evaluated inside the branch, so the absent path costs the test
// and nothing else.
//
// Nothing here allocates, deliberately. The callee is a *named* function, which
// is one static instance for the whole program rather than a closure made per
// iteration, and the holder never leaves the frame. A first version of this
// case built both through a factory and measured 1.47 ms against C++'s 20.57 us
// -- two heap allocations an iteration, and the optional call invisible
// underneath them. That number is real and is recorded in 0076; it is not what
// this row is for.
interface Held {
  fn?: (x: number) => number;
}

function plusOne(x: number): number {
  return x + 1;
}

export function run(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    const h: Held = {};
    if (i % 2 === 0) {
      h.fn = plusOne;
    }
    total = total + (h.fn?.(1) ?? 1);
  }
  return total;
}

/**
 * The input the harness calls `run` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 100000;
