/*---
description: A tag getter reached through an interface field changes object branding only for string results.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-accessors, ts-unions, ts-this, ts-numbers, ts-strings, ts-symbols]
---*/
// Symbol.toStringTag: A tagged plain object travels in a Holder field; node calls its tag getter with that object and ignores non-string tags.
const hookKey = Symbol.toStringTag, log: unknown[] = [];
interface Tagged { tag: string | number | undefined; readonly [Symbol.toStringTag]: string | number | undefined; }
interface Holder { target: Tagged; }
function make(tag: string | number | undefined): Tagged {
  return { tag, get [Symbol.toStringTag]() { log.push(this, this.tag); return this.tag; } };
}
function describe(holder: Holder): string { return Object.prototype.toString.call(holder.target); }
function hookKeys(target: Tagged): symbol[] { return Object.getOwnPropertySymbols(target); }
for (const input of ["", "Parcel", "\u00e9", 7, undefined]) {
  log.length = 0; const holder: Holder = { target: make(input) };
  assert.sameValue(describe(holder), `[object ${typeof input === "string" ? input : "Object"}]`);
  assert.compareArray(log, [holder.target, input]); assert.compareArray(hookKeys(holder.target), [hookKey]);
  holder.target.tag = "Changed";
  assert.sameValue(describe(holder), "[object Changed]");
  assert.compareArray(log, [holder.target, input, holder.target, "Changed"]);
}
