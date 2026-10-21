// A parameter a recursion increments is bounded by the test that stops it:
// `place(c + 1)` runs only after `c === 7` has returned, so `c` is 0 to 7.
// The interprocedural fixpoint widened such a bound straight to the `i32`
// limit, where `c + 1` can overflow, so `c` stayed a double -- and every
// index made from it, as `awfy-queens`' `placeQueen(c)` does. Widening now
// tries the constants the function compares against first.
//
// `placeTo` is the control: the same recursion stopped by a parameter rather
// than a constant, which offers no threshold, so its `c` stays a double.
//
// expect-ir: all: place param c is integer
// expect-ir: all: placeTo param c is float

const columns = [3, 1, 4, 1, 5, 9, 2, 6];

function place(c: number, seed: number): number {
  const mixed = (seed * 31 + columns[c]) | 0;
  if (c === 7) return mixed;
  return place(c + 1, mixed);
}

function placeTo(c: number, limit: number, seed: number): number {
  const mixed = (seed * 31 + c) | 0;
  if (c === limit) return mixed;
  return placeTo(c + 1, limit, mixed);
}

export function run(seed: number): number {
  return place(0, seed | 0);
}

export function runTo(seed: number): number {
  return placeTo(0, 7, seed | 0);
}
