// Object.prototype.toString has no implementation in this lowering.
// expect: this call was not resolved to a target
class Printable {
  constructor(public n: number) {}
  toString(): string { return "own"; }
}
function render<T extends { toString(): string }>(r: T): string {
  return r.toString();
}
export function probe(n: number): string { return render({ n }); }
