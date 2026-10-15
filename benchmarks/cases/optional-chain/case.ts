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
//
// **Each round reads what the round before it wrote.** The total chooses the
// path and is the argument: an even total takes the call and adds an odd
// number, an odd one adds 1, so the paths still alternate as they did when
// `i % 2` chose them. That earlier shape, called with `1`, had a closed form:
// LLVM took it for `wasm32` and answered in 1.6 ns (`((rounds - 4) >> 2) * 6 +
// 6` and three rounds), where for x86 it vectorised the loop and ran it, so
// the C++ cells measured two different optimisers rather than the call.
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
    if ((total & 1) === 0) {
      h.fn = plusOne;
    }
    total = total + (h.fn?.(total & 7) ?? 1);
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

// The representation this row measures (`nts expect-ir`): the optional call
// reaches the closure directly, not through a dispatch table, and the total
// over an `i32` count of rounds is an integer, not a double.
// expect-ir: all: no call.virtual in run
// expect-ir: all: block params in run#whole are integer
