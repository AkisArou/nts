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
