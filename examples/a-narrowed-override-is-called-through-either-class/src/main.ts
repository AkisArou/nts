// An override that narrows its result, called through the base and through
// itself.
//
// `Base#read(): unknown` and `Sub#read(): string | undefined` are one dispatch
// slot entered through two signatures: a call through a `Base` reads an erased
// value, and a call through a `Sub` named `Sub#read` and read a string. Once
// the slot answers erased -- `Sub`'s entry is a bridge that erases -- the call
// through `Sub` is made through the base's declaration and its answer read
// back as the string, or the `undefined`, the checker said it was.
class Base { read(n: number): unknown { return n; } }
class Sub extends Base { override read(n: number): string | undefined { return n > 0 ? "sub" : undefined; } }
class Deeper extends Sub { override read(n: number): string | undefined { return n > 1 ? "deeper" : undefined; } }
function score(value: unknown): number {
  if (value === undefined) return 1;
  return typeof value === "string" ? 10 + value.length : typeof value === "number" ? 100 + value : -99;
}
export function throughBase(which: number, n: number): number {
  const b: Base = which === 0 ? new Base() : which === 1 ? new Sub() : new Deeper();
  return score(b.read(n));
}
export function throughSub(which: number, n: number): number {
  const s: Sub = which === 0 ? new Sub() : new Deeper();
  const r = s.read(n);
  return r === undefined ? 0 : r.length;
}
