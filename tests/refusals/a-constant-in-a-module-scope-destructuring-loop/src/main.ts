// expect: `value`, a name from an enclosing scope
// A module-scope destructuring loop whose body keeps a const from its binding.
const pairs: [number, number][] = [[1, 2], [3, 4]];
let total = 0;
for (const [value, extra] of pairs) {
  const next = value + extra;
  total += next;
}
export function work(n: number): number { return total + n; }
