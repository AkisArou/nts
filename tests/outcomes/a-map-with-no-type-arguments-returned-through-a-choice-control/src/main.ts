// run: check
// backend: wasm
//
// The control for a-map-with-no-type-arguments-returned-through-a-choice: the
// allocation names its type arguments, `new Map<string, number>()`, so the
// table is built string-keyed and returned as what the function promised.
// Agrees on all four backends.

function make(seed: number): Map<string, number> | undefined {
  return (seed & 1) === 0 ? undefined : new Map<string, number>();
}

export function sizeOrMinusOne(seed: number): number {
  const m = make(seed);
  if (m === undefined) return -1;
  m.set("a", seed);
  return m.size * 10 + (m.get("a") === seed ? 1 : 0);
}
