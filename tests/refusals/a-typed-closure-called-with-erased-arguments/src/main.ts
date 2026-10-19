// expect: NTS1001 an erased value where a concrete representation is wanted is not supported by this lowering yet
// A typed closure called with erased (`any[]`) arguments is refused by the
// lowering, at the argument, on every backend. Graduates to tests/programs/
// when core admits the direct typed call. The values are numbers at
// runtime and node agrees on the result; what is missing is the admission
// the uniform erased entry already performs — unerase with a tag check at
// the call — applied to a direct typed call. Control: the same closure
// bound at an erased signature compiles and agrees with node today, so the
// refusal is the direct call's argument conversion, not the closure or the
// erased reads. From the uniform-callback-arguments profile: typed data
// forced through `any[]` cannot take the typed path until this lands
// (~/.cache/nts-scratch/wasm/queens-callbacks/SPLIT.md).
export function directTyped(seed: number): number {
  const add = (a: number, b: number): number => a + b;
  const values: any[] = [seed, seed + 1];
  return add(values[0], values[1]);
}
export function erasedSignature(seed: number): number {
  const add: (a: any, b: any) => number = (a: number, b: number): number => a + b;
  const values: any[] = [seed, seed + 1];
  return add(values[0], values[1]);
}
