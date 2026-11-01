/*---
description: Control for revivers-delete-array-element; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-revivers, ts-functions, ts-function-types, ts-type-aliases, ts-interfaces, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-type-guards, ts-record, ts-typeof-operator, ts-this-parameter, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Remove only the callback holder interface annotation; the plain literal retains the callback body, text, logs and all assertions.
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
  const handlers = { callback: function(this: unknown, key: string, value: unknown): unknown {
    log.push([key, snapshot(value), snapshot(this)]); holders.push(this);
    return key === "1" ? undefined : value;
  } };
  const value: unknown = JSON.parse('[' + n + ',-0,null]', handlers.callback);
  if (!Array.isArray(value)) throw new Error("shape"); const items: unknown[] = value;
  const before = "[number:" + n + ",number:-0,object:null]", after = "[number:" + n + ",,object:null]";
  const expected = [["0", "number:" + n, before], ["1", "number:-0", before], ["2", "object:null", after], ["", after, "{=" + after + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(items), after); assert.sameValue(items.length, 3); assert.compareArray(Object.keys(items), ["0", "2"]);
  assert.sameValue(typeof items[0], "number"); assert.sameValue(Object.is(items[0], n), true);
  assert.sameValue(typeof items[1], "undefined"); assert.sameValue(items[1], undefined); assert.sameValue(1 in items, false);
  assert.sameValue(typeof items[2], "object"); assert.sameValue(items[2], null);
  assert.compareArray(holders.slice(0, 3), [items, items, items]);
  const wrapper = holders[3]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], items);
}
