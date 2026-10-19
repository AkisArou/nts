/*---
description: Template literal substitutions convert numbers, booleans, arrays, null and undefined to their string forms.
features: [ts-template-literals]
---*/
const n = 1.5;
const big = 1e21;
const flag = false;
const list = [1, [2, 3]];
const nothing: null = null;
const absent: undefined = undefined;
assert.sameValue(`${n}|${big}|${flag}`, "1.5|1e+21|false");
assert.sameValue(`${list}`, "1,2,3");
assert.sameValue(`${nothing}-${absent}`, "null-undefined");
assert.sameValue(`${-0}`, "0");
