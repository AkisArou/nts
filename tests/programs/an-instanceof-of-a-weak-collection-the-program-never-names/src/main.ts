// `value instanceof WeakMap` in a program that never names a `WeakMap`
// otherwise: no type in the program is one, so no value it holds can be, and
// the test folds to `false` as it does where the type is present and has no
// representation. Requiring the type to be present refused `staticObjectName`
// in `internal/errors.ts`, and with it `Buffer.allocUnsafe`, in any program
// that did not mention a weak collection.
// Control: tests/programs/an-instanceof-of-a-map-beside-no-weak-collection.
function kind(value: object): number {
  if (value instanceof WeakMap) return 1;
  if (value instanceof WeakSet) return 2;
  if (value instanceof Map) return 3;
  return 0;
}
export function probe(n: number): number {
  const held: object = n > 0 ? new Map<number, number>([[n, n]]) : [n];
  return kind(held) * 10 + n;
}
