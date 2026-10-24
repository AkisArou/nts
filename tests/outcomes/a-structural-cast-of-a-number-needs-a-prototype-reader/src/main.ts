// run: check
// A primitive has no ordinary stack-like field, but it inherits toFixed.
// JS answers "function"; nts stops by name until it can read that prototype.
// The control changes only the receiver to an object with an own property.
class Own { toFixed: unknown = 1; }
function kindOf(source: unknown): string {
  const held = source as { toFixed?: unknown };
  return typeof held.toFixed;
}
export function primitive(n: number): string { return kindOf(n); }
export function control(_n: number): string { return kindOf(new Own()); }
