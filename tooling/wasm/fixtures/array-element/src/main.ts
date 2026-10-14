// Element reads that may name no element, read as `undefined` where node reads
// it, at any number as the index. Under `noUncheckedIndexedAccess`, a read
// that tells `undefined` apart is `nts_array_element`.
class Point {
  constructor(readonly x: number) {}
}
export function numberAt(x: number, y: number, at: number): number {
  const v = [x, y, x][at];
  return v === undefined ? 123 : v;
}
export function defaultedAt(x: number, at: number): number {
  return [x, x + 1][at] ?? -1;
}
export function booleanAt(x: boolean, at: number): number {
  const v = [x, !x][at];
  return v === undefined ? 2 : v ? 1 : 0;
}
export function unknownAt(x: string, y: number, at: number): number {
  const xs: unknown[] = [x, y];
  const v = xs[at];
  return v === undefined ? 1 : typeof v === 'string' ? 2 : 3;
}
// A null stored in an object array: node reads `null`, and the storage does not
// say whether a null slot held `null` or `undefined`, so Wasm refuses it.
export function nullSlot(at: number): number {
  const xs: (Point | null)[] = [new Point(1), null];
  const v = xs[at];
  return v === undefined ? 1 : v === null ? 2 : v.x;
}
function openArray(kind: number): unknown {
  if (kind === 0) return [1.5, -0, NaN];
  if (kind === 1) return ["a", "", "c"];
  if (kind === 2) return [true, false];
  if (kind === 3) return [new Point(7)];
  if (kind === 4) return [[1], [2, 3]];
  if (kind === 5) {
    const xs: unknown[] = ["u", 2, undefined];
    return xs;
  }
  // The program's only bigints: reading one through an open array boxes it.
  if (kind === 7) return [10n, -1180591620717411303424n];
  return "not an array";
}
// An element of an open array, whose storage the read cannot see: one type
// test per array storage, as C asks the descriptor.
export function openAt(kind: number, at: number): string {
  const value = openArray(kind);
  if (!Array.isArray(value)) return "none";
  const v: unknown = value[at];
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  return typeof v === "object" ? "object" : `${typeof v}:${String(v)}`;
}
