// Control: the argument supplies its own declared implementation.
class Printable {
  constructor(public n: number) {}
  toString(): string { return "own"; }
}
function render<T extends { toString(): string }>(r: T): string {
  return r.toString();
}
export function probe(n: number): string { return render(new Printable(n)); }
