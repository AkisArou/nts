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
