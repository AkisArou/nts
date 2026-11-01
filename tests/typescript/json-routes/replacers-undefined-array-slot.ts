/*---
description: Returning undefined through a declared replacer type writes null at an array index while leaving its original negative zero in place.
features: [ts-json-routes, ts-json-replacers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Replace one array value with undefined through a typed replacer; node emits null and preserves the source array and holder identities.
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
  const handlers: JsonCallbackSlot = { callback: function(this: unknown, key: string, value: unknown): unknown {
    log.push([key, snapshot(value), snapshot(this)]); holders.push(this);
    return key === "1" ? undefined : value;
  } };
  const input = [n, -0, true];
  assert.sameValue(JSON.stringify(input, handlers.callback), '[' + n + ',null,true]');
  const root = "[number:" + n + ",number:-0,boolean:true]";
  const expected = [["", root, "{=" + root + "}"], ["0", "number:" + n, root], ["1", "number:-0", root], ["2", "boolean:true", root]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.compareArray(holders.slice(1), [input, input, input]);
  const wrapper = holders[0]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], input);
  assert.sameValue(input.length, 3); assert.compareArray(Object.keys(input), ["0", "1", "2"]);
  assert.sameValue(snapshot(input), root); assert.sameValue(Object.is(input[1], -0), true);
}
