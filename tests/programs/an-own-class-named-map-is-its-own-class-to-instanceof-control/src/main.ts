// Control: the same class as its subject, named `Table`.
class Table {
  readonly entries: number[] = [];
  add(value: number): this {
    this.entries.push(value);
    return this;
  }
}
export function own(n: number): number {
  const made = new Table().add(n);
  return (made instanceof Table ? 10 : 0) + made.entries.length;
}
export function other(n: number): number {
  const value: object = [n];
  return value instanceof Table ? 1 : 0;
}
