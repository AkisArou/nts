/*---
description: Plain string-hook record control for A tag getter reached through an interface field changes object branding only for string results.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-unions, ts-function-types, ts-numbers, ts-strings, ts-record]
---*/
// String hook record: A tagged plain object travels in a Holder field; node calls its tag getter with that object and ignores non-string tags.
const hookKey = "hook:tag", log: unknown[] = [];
interface Tagged { tag: string | number | undefined; keys: string[]; hooks: Record<string, (self: Tagged) => string | number | undefined>; }
interface Holder { target: Tagged; }
function make(tag: string | number | undefined): Tagged {
  return { tag, keys: [hookKey], hooks: { [hookKey]: self => { log.push(self, self.tag); return self.tag; } } };
}
function describe(holder: Holder): string {
  const target = holder.target, tag = target.keys.includes(hookKey) ? target.hooks[hookKey](target) : undefined;
  return `[object ${typeof tag === "string" ? tag : "Object"}]`;
}
function hookKeys(target: Tagged): string[] { return target.keys.slice(); }
for (const input of ["", "Parcel", "\u00e9", 7, undefined]) {
  log.length = 0; const holder: Holder = { target: make(input) };
  assert.sameValue(describe(holder), `[object ${typeof input === "string" ? input : "Object"}]`);
  assert.compareArray(log, [holder.target, input]); assert.compareArray(hookKeys(holder.target), [hookKey]);
  holder.target.tag = "Changed";
  assert.sameValue(describe(holder), "[object Changed]");
  assert.compareArray(log, [holder.target, input, holder.target, "Changed"]);
}
