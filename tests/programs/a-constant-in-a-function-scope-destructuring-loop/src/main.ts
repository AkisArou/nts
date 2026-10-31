// Control for a-constant-in-a-module-scope-destructuring-loop.
// The identical loop runs once inside a function instead of at module scope.
const pairs: [number, number][] = [[1, 2], [3, 4]];
let total = 0;
function run(): void {
  for (const [value, extra] of pairs) {
    const next = value + extra;
    total += next;
  }
}
run();
export function work(n: number): number { return total + n; }
