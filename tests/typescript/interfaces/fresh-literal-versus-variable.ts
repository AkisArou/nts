/*---
description: Extra properties in a non-fresh object pass through an interface-typed parameter and remain on the object.
features: [ts-interfaces, ts-structural-typing]
---*/
interface Tagged {
  tag: string;
}
function keysOf(value: Tagged): string {
  return Object.keys(value).join(",");
}
const withExtras = { tag: "t", extra: 1, more: true };
assert.sameValue(keysOf(withExtras), "tag,extra,more");
const narrowed: Tagged = withExtras;
assert.sameValue((narrowed as { extra?: number }).extra, 1);
