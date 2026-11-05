/*---
description: "An undefined base skips a property and returns undefined. Route: optional interface field"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// An undefined base skips a property and returns undefined. Route: optional interface field. Node prints chains-undefined-root-result:ok.
interface Slot { value?: { text: string } }
function read(slot: Slot): string | undefined {
  const result = slot.value?.text;
  return result;
}
assert.sameValue(read({}), undefined);
assert.sameValue(read({ value: undefined }), undefined);
assert.sameValue(read({ value: { text: "yes" } }), "yes");
console.log("chains-undefined-root-result:ok");
