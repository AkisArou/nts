// Objects allocated and dropped in a loop, which is the only shape of workload
// where the memory provider is visible at all. Every other case here allocates
// nothing, and reference counting costs them exactly nothing as a result.
//
// It depends on `seed`, so none of it folds away at compile time.
class Vec2 {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  dot(other: Vec2): number {
    return this.x * other.x + this.y * other.y;
  }
}

export function simulate(seed: number): number {
  const base = new Vec2(seed, seed + 1);
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    const point = new Vec2(i, i + 1);
    total = total + point.dot(base);
  }
  return total;
}

/**
 * The input the harness calls `simulate` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
