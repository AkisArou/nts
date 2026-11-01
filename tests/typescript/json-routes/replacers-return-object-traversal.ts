/*---
description: An object returned through a declared replacer type is visited recursively with that returned object as the child holder.
features: [ts-json-routes, ts-json-replacers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Replace a numeric property with a record through a typed replacer; node visits the new record and leaves the source value unchanged.
function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function snapshot(value: unknown): string {
  if (Array.isArray(value)) { const items: unknown[] = value; return "[" + items.map(snapshot).join(",") + "]"; }
  if (jsonObject(value)) return "{" + Object.keys(value).map(key => key + "=" + snapshot(value[key])).join(",") + "}";
  return Object.is(value, -0) ? "number:-0" : typeof value + ":" + String(value);
}
type JsonCallback = (this: unknown, key: string, value: unknown) => unknown;
interface JsonCallbackSlot { callback: JsonCallback; }
for (const n of [-2, 0, 3]) {
  const log: string[][] = [], holders: unknown[] = [];
  const replacement = { label: "n" + n, value: n + 1 };
  const handlers: JsonCallbackSlot = { callback: function(this: unknown, key: string, value: unknown): unknown {
    log.push([key, snapshot(value), snapshot(this)]); holders.push(this);
    return key === "old" ? replacement : value;
  } };
  const input = { old: n, keep: true };
  assert.sameValue(JSON.stringify(input, handlers.callback), '{"old":{"label":"n' + n + '","value":' + (n + 1) + '},"keep":true}');
  const root = "{old=number:" + n + ",keep=boolean:true}", child = "{label=string:n" + n + ",value=number:" + (n + 1) + "}";
  const expected = [["", root, "{=" + root + "}"], ["old", "number:" + n, root], ["label", "string:n" + n, child],
    ["value", "number:" + (n + 1), child], ["keep", "boolean:true", root]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.compareArray(holders.slice(1), [input, replacement, replacement, input]);
  const wrapper = holders[0]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], input);
  assert.sameValue(snapshot(input), root); assert.sameValue(snapshot(replacement), child); assert.sameValue(Object.is(input.old, n), true);
}
