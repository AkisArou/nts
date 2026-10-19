/*---
description: for-in over a typed object visits own and inherited enumerable string keys, but not symbol keys.
features: [ts-iteration, ts-objects, ts-symbols]
---*/
const hidden = Symbol("hidden");
const prototypeObject = { inherited: 1 };
const child: { own: number; [hidden]: number } = Object.assign(Object.create(prototypeObject) as object, { own: 2, [hidden]: 3 });
const keys: string[] = [];
for (const key in child) keys.push(key);
assert.compareArray(keys, ["own", "inherited"]);
assert.compareArray(Object.keys(child), ["own"]);
