// A default reads the real receiver and a generator binds before next().
// Their supplied-argument controls differ only in whether the call omits x.
// Optional number/string, null string and any inputs retain their absence.
// Clean 6ead61dae14e (2e88745755bd6263): C/LLVM/JVM compare 261/9,
// with 57 wrong (28 receiver defaults, 29 generator defaults). Wasm compares
// 203/261 correctly and declines the 58 subjects. Clean ccebd9080df9 agrees
// on every 261/9 case on all four backends, with no declines or refusals.
export function invoke(callback: (x?: any) => number): number { return callback(); }
export function invokeValue(callback: (x?: any) => number, value: any): number { return callback(value); }
export function optionalNumber(n: number): number { return invoke((x?: number): number => x === undefined ? 7 : x); }
export function optionalString(n: number): number { return invoke((x?: string): number => x === undefined ? 7 : x.length); }
export function nullableString(n: number): number { return invokeValue((x: string | null): number => x === null ? 11 : x.length, null); }
export function suppliedString(n: number): number { return invokeValue((x: string): number => x.length, "abc"); }
export function alreadyAny(n: number): number { return invoke((x: any): number => x === undefined ? 7 : 9); }
class Holder {
  base: number;
  callback: (this: Holder, x?: any) => number;
  constructor(n: number) {
    this.base = n;
    this.callback = function(this: Holder, x: number = this.base): number { return x; };
  }
}
export function ownThis(n: number): number { return new Holder(n).callback(); }
export function ownThisSupplied(n: number): number { return new Holder(n).callback(n); }
export function generatorEntry(make: (x?: any) => Generator<number>, supplied: boolean): Generator<number> {
  return supplied ? make(3) : make();
}
function generatorResult(n: number, supplied: boolean): number {
  let effects = 0;
  const make = function*(x: number = (effects++, 3)): Generator<number> { yield x; };
  const iterator = generatorEntry(make, supplied);
  const atCall = effects;
  const next = iterator.next();
  return atCall * 100 + (next.done ? -1000 : next.value);
}
export function eagerGenerator(n: number): number { return generatorResult(n, false); }
export function generatorSupplied(n: number): number { return generatorResult(n, true); }
