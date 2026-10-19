/*---
description: A `declare function` emits nothing; calls reach the function installed on the global object.
features: [ts-ambient, ts-functions]
---*/
declare function hostLog(message: string): number;
const messages: string[] = [];
(globalThis as { hostLog?: (message: string) => number }).hostLog = (message) => messages.push(message);
assert.sameValue(hostLog("a"), 1);
assert.sameValue(hostLog("b"), 2);
assert.compareArray(messages, ["a", "b"]);
