// A native record answers for its own keys: there is no prototype to reach
// through, so `Object.hasOwn` is the whole test.

export function hasOwn(object: { readonly [key: string]: unknown }, key: string): boolean {
  return Object.hasOwn(object, key);
}
