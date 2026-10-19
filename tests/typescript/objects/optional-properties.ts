/*---
description: An optional property may be absent or present as undefined, and `in` tells the two apart.
features: [ts-objects, ts-optional-properties]
---*/
type Draft = { title: string; body?: string };
const absent: Draft = { title: "a" };
const explicit: Draft = { title: "b", body: undefined };
assert.sameValue(absent.body, undefined);
assert.sameValue(explicit.body, undefined);
assert.sameValue("body" in absent, false);
assert.sameValue("body" in explicit, true);
assert.sameValue(Object.keys(explicit).length, 2);
