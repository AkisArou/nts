// A closure a module-scope `const` holds, called in a loop.
//
// Neither arrow captures anything -- at module scope there is nothing to
// capture -- and neither binding can be reassigned. So each is one immortal
// object with no state, which is the same thing `function-values` already
// emits for a named function used as a value: a static.

const scale = (x: number): number => x * 2;
const add = (a: number, b: number): number => a + b;

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    total = add(total, scale(i));
  }
  return total;
}
