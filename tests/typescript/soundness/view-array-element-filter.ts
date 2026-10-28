/*---
description: A readonly numeric array view preserves a mutated string through a filter result.
features: [ts-unsound-covariant-view, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-covariant-array]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: number[] = [2, 0];
const values: readonly number[] = mutable;
const wider: unknown[] = mutable;
wider[1] = "7";
const kept: number[] = values.filter((value: number) => value !== 2);
assert.sameValue(kept.length, 1);
assert.sameValue(typeof kept[0], "string");
assert.sameValue(String(kept[0] + 1), "71");
assert.sameValue(kept[0] === 7, false);
