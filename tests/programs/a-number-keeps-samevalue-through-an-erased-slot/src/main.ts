function value(n: unknown): unknown { return n; }
export function erasedLeft(n: number): boolean { return Object.is(value(n), n); }
export function erasedRight(n: number): boolean { return Object.is(n, value(n)); }
export function erasedBoth(n: number): boolean { return Object.is(value(n), value(n)); }
export function oppositeBoth(n: number): boolean { return Object.is(value(n), value(-n)); }
export function oppositeLeft(n: number): boolean { return Object.is(value(n), -n); }
export function oppositeRight(n: number): boolean { return Object.is(n, value(-n)); }
export function typedSelf(n: number): boolean { return Object.is(n, n); }
export function typedOpposite(n: number): boolean { return Object.is(n, -n); }
export function twoZeros(n: number): boolean {
  return Object.is(value(n > 0 ? 0 : -0), value(0));
}
export function calculatedNaNs(n: number): boolean {
  return Object.is(value(n / n), value(n / n));
}
export function unequalNumbers(n: number): boolean { return Object.is(value(n), value(n + 1)); }
export function stringContent(n: number): boolean { return Object.is(value(String(n)), value(String(n))); }
export function unequalStrings(n: number): boolean { return Object.is(value(String(n)), value(String(n) + "!")); }
export function differentTypes(n: number): boolean { return Object.is(value(n), value(String(n))); }
export function booleans(n: number): boolean { return Object.is(value(n > 0), n > 0); }
export function sameAbsence(n: number): boolean {
  const a = n > 0 ? null : undefined;
  return Object.is(value(a), value(a));
}
export function differentAbsences(n: number): boolean {
  return Object.is(value(n > 0 ? null : undefined), value(n > 0 ? undefined : null));
}
class Box { constructor(public n: number) {} }
export function sameObject(n: number): boolean {
  const a = new Box(n); return Object.is(value(a), a);
}
export function differentObjects(n: number): boolean {
  return Object.is(value(new Box(n)), value(new Box(n)));
}
export function sameArray(n: number): boolean { const a = [n]; return Object.is(value(a), a); }
export function differentArrays(n: number): boolean { return Object.is(value([n]), value([n])); }
export function sameFunction(n: number): boolean {
  const a = (v: number): number => v + n; return Object.is(value(a), a);
}
export function differentFunctions(n: number): boolean {
  return Object.is(value((v: number) => v + n), value((v: number) => v + n));
}
export function sameSymbol(n: number): boolean {
  const a = Symbol(String(n)); return Object.is(value(a), a);
}
export function differentSymbols(n: number): boolean {
  return Object.is(value(Symbol(String(n))), value(Symbol(String(n))));
}
class Trace {
  count = 0;
  left(n: number): unknown { this.count = this.count * 10 + 1; return n; }
  right(n: number): unknown { this.count = this.count * 10 + 2; return n; }
}
export function evaluatesInOrder(n: number): boolean {
  const trace = new Trace();
  const equal = Object.is(trace.left(n), trace.right(n));
  return equal && trace.count === 12;
}
