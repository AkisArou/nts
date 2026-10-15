// An object literal typed by an interface whose optional function field only
// ever holds one function: `benchmarks/cases/optional-chain`'s shape, and the
// call through it is direct (compiler/core/tests/devirtualize.rs).
interface Held {
  fn?: (x: number) => number;
}

function plusOne(x: number): number {
  return x + 1;
}

export function run(rounds: number): number {
  let total = 0;
  for (let i = 0; i < (rounds & 255); i = i + 1) {
    const h: Held = {};
    if ((total & 1) === 0) {
      h.fn = plusOne;
    }
    total = total + (h.fn?.(total & 7) ?? 1);
  }
  return total;
}
