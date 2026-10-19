/*---
description: A function's length counts parameters before the first default or rest; optional and `this` parameters do not change it.
features: [ts-functions, ts-optional-parameters, ts-default-parameters, ts-this-parameter]
---*/
function plain(a: number, b: number): number {
  return a + b;
}
function optional(a: number, b?: number): number {
  return a + (b ?? 0);
}
function defaulted(a: number, b = 1, c?: number): number {
  return a + b + (c ?? 0);
}
function rest(a: number, ...more: number[]): number {
  return a + more.length;
}
function withThis(this: { base: number }, a: number): number {
  return this.base + a;
}
assert.sameValue(plain.length, 2);
assert.sameValue(optional.length, 2);
assert.sameValue(defaulted.length, 1);
assert.sameValue(rest.length, 1);
assert.sameValue(withThis.length, 1);
