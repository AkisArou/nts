let held: any = 0;
declare function outside(value: any): void;

function returned(value: any): any { value.toFixed(1); return value; }
function stored(value: any): number { held = value; return value.toFixed(1).length; }
function forwardedToStorage(value: any): number { return stored(value); }
function mutable(value: any): number { value = "changed"; return value.length; }
function mutableAlias(value: any): number { let alias = value; alias = "changed"; return alias.length; }
function captured(value: any): number { const read = () => value.toFixed(1).length; return read(); }
function unresolved(value: any): number { outside(value); return value.toFixed(1).length; }
function unresolvedForwarder(value: any): number { return unresolved(value); }
function selected(value: any): number { held = value || "fallback"; return value.toFixed(1).length; }
function sequenced(value: any): number { held = (held = 0, value); return value.toFixed(1).length; }
function defaulted(value: any = 1): number { return value.toFixed(1).length; }
function escaped(value: any): number { return value.toFixed(1).length; }
const escapedValue = escaped;
export function exported(value: any): number { return value.toFixed(1).length; }
function reexported(value: any): number { return value.toFixed(1).length; }
export { reexported };
function asserted(value: any): number { return value.toFixed(1).length; }
function assertedAlias(value: any): number { return value.toFixed(1).length; }
function spreadPosition(first: number, value: any): number { return value.toFixed(1).length; }
function powered(value: any): number { return value ** 2; }
function againstBigInt(value: any): number { return value < 9007199254740993n ? 1 : 0; }
function againstBigIntAlias(value: any): number { const big = 9007199254740993n; return big > value ? 1 : 0; }
function forwardsToBigInt(value: any): number { return againstBigInt(value); }
function hasThis(this: void, value: any, other: any): number { return value.toString().length; }
function uncarried(value: any, callback: () => void): number { callback(); return value.toFixed(1).length; }
function readCompared(value: any): number { return value[5] === undefined ? 1 : 0; }
function readConcatenated(value: any): string { return "at " + value[0]; }
function readOfStrings(value: any): number { return value[0] - 1; }
export function elementReads(n: number): number {
  return readCompared([n, 2]) + readConcatenated([n]).length + readOfStrings(["1"]);
}

export function boundaries(n: number): void {
  returned(n); stored(n); forwardedToStorage(n); mutable(n); mutableAlias(n);
  captured(n); unresolved(n); unresolvedForwarder(n); selected(n); sequenced(n);
  powered(n); defaulted(n); escaped(n); escapedValue(n); exported(n); reexported(n);
  againstBigInt(n); againstBigInt("9007199254740992");
  againstBigIntAlias(n); forwardsToBigInt(n);
  asserted("not a number" as unknown as number);
  const pretend = "not a number" as unknown as number;
  assertedAlias(pretend);
  spreadPosition(...[0] as [number], n); hasThis(n, "other");
  try { uncarried(n, () => { throw new Error("not carried"); }); } catch {}
}

function bounded(a: any, b: any, c: any, d: any): number {
  return (a | 0) + (b | 0) + (c | 0) + (d | 0);
}
export function budget(): number {
  return bounded(1, 1, 1, 1) + bounded("1", 1, 1, 1)
    + bounded(1, "1", 1, 1) + bounded("1", "1", 1, 1)
    + bounded(1, 1, "1", 1) + bounded("1", 1, "1", 1)
    + bounded(1, "1", "1", 1) + bounded("1", "1", "1", 1)
    + bounded(1, 1, 1, "1") + bounded(1, 1, 1, 1);
}
