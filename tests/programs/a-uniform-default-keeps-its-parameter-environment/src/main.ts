// Open calls must execute defaults in the implementation's parameter scope.
// The assignment/read pair differs only in the second initializer's operator.
// Shared parameter cells and a distinct body var are the landed entry controls.
// Before: clean 6ead61dae14e / binary 2e88745755bd6263 / frontend 4ec6b1a5.
// C/LLVM/JVM compare 174/6, with 87 wrong; Wasm compares 87/174,
// all agreeing, with 87 named declines. Captured-default controls agree.
export function withoutArguments(callback: (x?: any, y?: any) => number, n: number): number {
  return callback();
}
export function withFirst(callback: (x?: any, y?: any) => number, n: number): number {
  return callback(n);
}
export function assignsEarlier(n: number): number {
  return withoutArguments((x: number = 1, y: number = (x = 2)) => x * 100 + y, n);
}
export function readsEarlier(n: number): number {
  return withoutArguments((x: number = 1, y: number = (x + 2)) => x * 100 + y, n);
}
export function sharedCell(n: number): number {
  return withFirst((x: number, f: () => number = () => x) => { x = 2; return f(); }, n);
}
function separate(x: number, f: () => number = () => x): number {
  var x: number;
  x = 2;
  return f();
}
export function bodyVar(n: number): number { return withFirst(separate, n); }
export function undefinedOnce(n: number): number {
  let effects = 0;
  const f = (x: any = (effects++, undefined), read = () => x): number =>
    (read() === undefined ? 10 : 20) + effects;
  return withoutArguments(f, n);
}
export function earlierEffects(n: number): number {
  let effects = 0;
  const f = (x: any = (effects++, undefined), y: number = (effects++, n)): number =>
    effects * 100 + y;
  return withoutArguments(f, n);
}
