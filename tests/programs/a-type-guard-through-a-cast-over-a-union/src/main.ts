// A user-defined type guard written as every one is:
// `(shape as Square).side !== undefined` over a `Square | Named`. `as` has no
// run-time effect, so node reads `side` off whatever object arrived and finds
// it only on a `Square`. nts read through `Square`'s offsets, so a `Named`'s
// field 0 -- its `name` string -- was read as `side`; since the cast check it
// was refused instead. The comparison is a presence question now, answered by
// which members declare `side`, as `"side" in shape` is.
//
// `byIn` is the control: the same question asked with `in`, which agreed.

type Square = { side: number };
type Named = { name: string };

function isSquare(shape: Square | Named): shape is Square {
  return (shape as Square).side !== undefined;
}

function isNamed(shape: Square | Named): boolean {
  return undefined !== (shape as Named).name;
}

function byIn(shape: Square | Named): boolean {
  return "side" in shape;
}

function pick(n: number): Square | Named {
  return (n & 1) === 0 ? { side: n & 7 } : { name: `n${n}` };
}

export function guarded(n: number): number {
  const shape = pick(n);
  return isSquare(shape) ? shape.side : -1;
}

export function named(n: number): boolean {
  return isNamed(pick(n));
}

export function control(n: number): boolean {
  return byIn(pick(n));
}
