/*---
description: Spreading a numeric array copies the string stored through its wider alias.
features: [ts-unsound-covariant-array, ts-arrays, ts-spread, ts-iteration, ts-typeof-operator]
---*/
// Covariance lets TypeScript pass number[] to a writer of unknown[] and
// retain the numeric view. Node's spread copies the stored string unchanged.
function append(values: unknown[]): void {
  values.push("7");
}
const values: number[] = [2];
append(values);
const copied: number[] = [...values];
assert.sameValue(JSON.stringify(copied), '[2,"7"]');
assert.sameValue(typeof copied[1], "string");
