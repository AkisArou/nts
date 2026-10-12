export function throwNumber(x: number): string { throw x; }
export function throwBoolean(x: boolean): string { throw x; }
export function throwString(x: string): number { throw x; }
export function throwNull(): number { throw null; }
export function throwUndefined(): number { throw undefined; }

function fail(x: number): number {
  if (x < 0) throw x;
  return x + 1;
}
export function caughtNumber(x: number): number {
  try { return fail(x); }
  catch (e) { if (typeof e === 'number') return e - 1; return 99; }
}
export function caughtString(x: string): string {
  try { return throwString(x).toString(); }
  catch (e) { if (typeof e === 'string') return e; return 'other'; }
}
export function nestedFinally(x: number): number {
  let result = 0;
  try {
    try { result = fail(x); }
    finally { result += 2; }
  } catch (e) { if (typeof e === 'number') result += e + 4; }
  return result;
}
export function overrideFinally(x: number): number {
  try { throw x; }
  finally { return x + 1; }
}
export function rethrow(x: number): string {
  try { return throwNumber(x); }
  catch (e) { throw e; }
}
export function closureCatch(x: number): number {
  const f = (): number => { if (x < 0) throw x; return x; };
  try { return f(); }
  catch (e) { if (typeof e === 'number') return e - 2; return 99; }
}
export function closureStringCatch(x: string): string {
  const f = (): string => { if (x.length > 0) throw x; return x; };
  try { return f(); }
  catch (e) { if (typeof e === 'string') return e; return 'other'; }
}
class Base {
  run(x: number): number { if (x < 0) throw x; return x + 1; }
}
class Child extends Base {
  run(x: number): number { if (x < 0) throw x; return x + 3; }
}
export function classCatch(x: number, child: boolean): number {
  const item: Base = child ? new Child() : new Base();
  try { return item.run(x); }
  catch (e) { if (typeof e === 'number') return e - 3; return 99; }
}
