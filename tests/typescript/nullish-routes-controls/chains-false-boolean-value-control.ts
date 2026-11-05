/*---
description: "Optional method call on false boolean is not skipped. Route: boolean or undefined interface field (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Optional method call on false boolean is not skipped. Route: boolean or undefined interface field. Node prints chains-false-boolean-value:ok.
interface Slot { flag: boolean | undefined }
function read(slot: Slot): boolean | undefined {
  const saved = slot.flag; const result = saved === null || saved === undefined ? undefined : saved.valueOf();
  return result;
}
assert.sameValue(read({ flag: false }), false);
assert.sameValue(read({ flag: true }), true);
assert.sameValue(read({ flag: undefined }), undefined);
console.log("chains-false-boolean-value:ok");
