// expect: a call inside a body that carries a `throw` back to its caller
interface Wakeable { then(resolve: () => unknown, reject: () => unknown): unknown }
function invoke(value: Wakeable): number {
  value.then(() => undefined, () => undefined);
  return 11;
}
function run(value: Wakeable): number {
  try { return invoke(value); } catch { return 17; }
}
interface Thenable<T> { then(resolve: (value: T) => unknown, reject: (error: unknown) => unknown): unknown }
export function caught(n: number): number {
 const value: Thenable<void> = { then: (resolve: (value: void) => unknown): void => { if (n < 0) throw new Error("bad"); resolve(undefined); } };
 return run(value);
}
