// The recorder every other module reports to, and the bottom of the diamond.
//
// `main` imports `a` and `b`; both import this. ES module evaluation is a
// post-order walk of that graph with each module's imports taken in *source*
// order, so this evaluates first and `main` last. Node was asked rather than
// assumed: the same diamond in `.mjs` prints `d, a, b, main`, and `d, b, a,
// main` when `main`'s two import lines are swapped -- which is why the module
// graph stores a module's imports ordered rather than as a set.
let order = 0;

// A digit per module, in the order they ran. A number rather than a string so
// that `nts check` compares it: the differential drives exported functions
// with scalar arguments and a scalar result.
export function note(digit: number): void {
  order = order * 10 + digit;
}

export function evaluated(): number {
  return order;
}

note(1);
