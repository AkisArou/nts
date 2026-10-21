// run: check
// backend: wasm
//
// A `new Map()` with no type arguments, as an arm of a conditional returned
// as a `Map<string, number> | undefined`. The zero-argument overload in the
// library is `new (): Map<any, any>`, so the checker types the allocation, and
// the conditional over it, `Map<any, any>`: lowering builds the table with
// erased keys and returns that `managed<map<erased, erased>>` where the
// function promised `managed<map<str, f64>>`, with no conversion between. C,
// LLVM and the JVM hold every table at one representation and agree; Wasm
// builds a table's storage from its type, and declines the function ("no Wasm
// cast relates their storage"), so nothing is checked. The same holds for a
// bare `return new Map()` and for `const m: Map<string, number> = new Map()`.
//
// The one-change control, `...-control`, writes `new Map<string, number>()`
// and agrees on all four.

function make(seed: number): Map<string, number> | undefined {
  return (seed & 1) === 0 ? undefined : new Map();
}

export function sizeOrMinusOne(seed: number): number {
  const m = make(seed);
  if (m === undefined) return -1;
  m.set("a", seed);
  return m.size * 10 + (m.get("a") === seed ? 1 : 0);
}
