/*---
description: A default parameter is evaluated at each call that omits it, and may read earlier parameters.
features: [ts-functions, ts-default-parameters]
---*/
let calls = 0;
function stamp(): number {
  return ++calls;
}
function entry(label: string, id: number = stamp(), tag: string = `${label}-${id}`): string {
  return tag;
}
assert.sameValue(entry("a"), "a-1");
assert.sameValue(entry("b"), "b-2");
assert.sameValue(entry("c", 9), "c-9");
assert.sameValue(entry("d", undefined, "custom"), "custom");
assert.sameValue(calls, 3);
