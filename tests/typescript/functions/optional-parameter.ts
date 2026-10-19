/*---
description: An omitted optional parameter is undefined, and the function tests for it.
features: [ts-functions, ts-optional-parameters]
---*/
function greet(who: string, title?: string): string {
  return title === undefined ? `hi ${who}` : `hi ${title} ${who}`;
}
assert.sameValue(greet("kim"), "hi kim");
assert.sameValue(greet("kim", "dr"), "hi dr kim");
assert.sameValue(greet("kim", undefined), "hi kim");
