// The control for `erasure-unknown`: the same loop with the same arithmetic,
// written with the types the checker would infer anyway.
//
// The pair is the measurement. Neither number means much alone -- what the
// cost of erasure *is* is the ratio between them, and it is only a ratio if
// the two programs differ in exactly one thing.
function widen(value: number): number {
  return value;
}

function kindOf(value: number): number {
  return typeof value === "number" ? 1 : 0;
}

function readBack(value: number): number {
  return typeof value === "number" ? value : 0;
}

export function erasureTyped(seed: number): number {
  let total = 0;
  for (let i = 0; i < 200000; i++) {
    const carried = widen(seed + i);
    total = total + kindOf(carried) + readBack(carried);
  }
  return total;
}

/**
 * The input the harness calls `erasureTyped` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 12345;
