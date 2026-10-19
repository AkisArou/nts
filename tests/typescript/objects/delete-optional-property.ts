/*---
description: Deleting an optional property removes it from the object.
features: [ts-objects, ts-optional-properties]
---*/
type Cached = { value: number; stale?: boolean };
const cached: Cached = { value: 1, stale: true };
delete cached.stale;
assert.sameValue("stale" in cached, false);
assert.sameValue(Object.keys(cached).join(","), "value");
cached.stale = false;
assert.sameValue(Object.keys(cached).join(","), "value,stale");
