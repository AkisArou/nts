// Module-scope numeric state, read and written in a loop.
//
// `hir::globals` changes what this is *held in* -- a `double` slot becomes an
// `int32_t` one, and the arithmetic around the read stays in a register. What
// it must not change is what this costs the allocator, which is nothing.

let total = 0;
let step = 0;

export function work(n: number): number {
  step = (n | 0) + 1;
  let running = 0;
  for (let i = 0; i < 16 + n; i++) {
    running = (running + step * i) | 0;
  }
  total = running;
  return total;
}
