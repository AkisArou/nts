/*---
description: A non-null assertion is erased: it does not check, so undefined passes through it.
features: [ts-non-null]
---*/
const map = new Map<string, number>([["a", 1]]);
const present = map.get("a")!;
const missing = map.get("z")!;
assert.sameValue(present + 1, 2);
assert.sameValue(missing, undefined);
const empty: { value?: { n: number } } = {};
assert.throws(TypeError, () => {
  empty.value!.n;
});
