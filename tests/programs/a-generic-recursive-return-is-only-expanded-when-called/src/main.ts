// The declaration contains a recursive conditional generic. Its scalar
// instantiations need no recursive object walk; both explicit depths execute.
type Previous = [never, 0, 1, 2];
type DeepReadonly<T, D extends number> = D extends 0 ? T : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K], Previous[D]> } : T;
function readonlyAt<T, D extends number>(value: T, depth: D): DeepReadonly<T, D> {
  return value as DeepReadonly<T, D>;
}
function identityAt<T, D extends number>(value: T, depth: D): T { return value; }
export function depthOne(n: number): number { return readonlyAt(n + 1, 1); }
export function depthTwo(n: number): number { return readonlyAt(n + 1, 2); }
export function controlOne(n: number): number { return identityAt(n + 1, 1); }
export function controlTwo(n: number): number { return identityAt(n + 1, 2); }
