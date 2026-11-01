// A program's own class named `Map` is that class to `instanceof`. The
// builtin's test was chosen by the right operand's name, so an own `Map`
// answered as the runtime's table would, which it is not.
// The control names the same class `Table`.
class Map {
  readonly entries: number[] = [];
  add(value: number): this {
    this.entries.push(value);
    return this;
  }
}
export function own(n: number): number {
  const made = new Map().add(n);
  return (made instanceof Map ? 10 : 0) + made.entries.length;
}
export function other(n: number): number {
  const value: object = [n];
  return value instanceof Map ? 1 : 0;
}
