/*---
description: A declared reviver function type wraps a parsed child object without recursively visiting the newly returned wrapper.
features: [ts-json-routes, ts-json-revivers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Replace a child object through a typed reviver; node reuses the original child inside a new wrapper and visits no new wrapped key.
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
    return key === "item" ? { wrapped: value } : value;
  } };
  const value: unknown = JSON.parse('{"item":{"n":' + n + '},"tail":true}', handlers.callback);
  if (!jsonObject(value) || !jsonObject(value.item) || !jsonObject(value.item.wrapped)) throw new Error("shape");
  const child = "{n=number:" + n + "}", before = "{item=" + child + ",tail=boolean:true}";
  const after = "{item={wrapped=" + child + "},tail=boolean:true}";
  const expected = [["n", "number:" + n, child], ["item", child, before], ["tail", "boolean:true", after], ["", after, "{=" + after + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(value), after); assert.compareArray(Object.keys(value), ["item", "tail"]);
  assert.compareArray(Object.keys(value.item), ["wrapped"]); assert.compareArray(Object.keys(value.item.wrapped), ["n"]);
  assert.sameValue(typeof value.item, "object"); assert.sameValue(typeof value.item.wrapped, "object");
  assert.sameValue(typeof value.item.wrapped.n, "number"); assert.sameValue(Object.is(value.item.wrapped.n, n), true);
  assert.sameValue(typeof value.tail, "boolean"); assert.sameValue(value.tail, true);
  assert.compareArray(holders.slice(0, 3), [value.item.wrapped, value, value]);
  const wrapper = holders[3]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], value);
}
