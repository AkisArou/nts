// `nts check` under Wasm publishes only the functions it calls, and still
// compiles every function. `keyed` is never called (its parameter is not a
// scalar), and its body is one the Wasm backend declines -- a Map keyed by a
// typed array -- so the check fails naming it, rather than passing on `count`
// alone. C compiles both and agrees.
export function count(n: number): number {
  return n + 1;
}

export function keyed(xs: Uint8Array): number {
  const seen = new Map<Uint8Array, number>();
  seen.set(xs, 1);
  return seen.size;
}
