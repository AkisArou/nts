/*---
description: A numeric reduction concatenates when its next element is an injected string.
features: [ts-unsound-covariant-array, ts-arrays, ts-arrow-functions, ts-conversions, ts-typeof-operator]
---*/
// TypeScript allows the covariant array write and gives reduce numeric
// arguments and a numeric result. Node concatenates when it reaches "7".
function append(values: unknown[]): void {
  values.push("7");
}
const values: number[] = [2];
append(values);
const total: number = values.reduce((sum: number, value: number) => sum + value, 0);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
