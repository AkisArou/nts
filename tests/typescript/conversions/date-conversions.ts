/*---
description: A Date converts to its time value under the number hint and to a string under the default hint.
features: [ts-conversions, ts-to-primitive]
---*/
const epoch = new Date(0);
const later = new Date(86400000);
assert.sameValue(+epoch, 0);
assert.sameValue(Number(later), 86400000);
assert.sameValue(later.getTime() - epoch.getTime(), 86400000);
assert.sameValue(later > epoch, true);
const anyDate: any = epoch;
assert.sameValue(typeof (anyDate + 1), "string");
assert.sameValue(anyDate - 1, -1);
