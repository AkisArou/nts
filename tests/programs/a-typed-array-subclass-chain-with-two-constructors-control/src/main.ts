// Control: the same chain with no constructors, the work done at the site.
let trail = 0;
class Base extends Uint8Array {}
class Middle extends Base {}
class Derived extends Middle {}
export function derived(n: number): number {
  trail = 0;
  trail = trail * 10 + 2;
  trail = trail * 10 + 1;
  const bytes = new Derived((n & 7) * 2 + 2 + 1);
  bytes.fill(7, 0, 1);
  bytes.fill(9, 1, 2);
  return bytes.length * 100000 + bytes[0]! * 1000 + bytes[1]! * 100 + trail;
}
export function middle(n: number): number {
  trail = 0;
  trail = trail * 10 + 1;
  const bytes = new Middle((n & 3) + 1 + 1);
  bytes.fill(7, 0, 1);
  return bytes.length * 1000 + bytes[0]! * 10 + trail;
}
