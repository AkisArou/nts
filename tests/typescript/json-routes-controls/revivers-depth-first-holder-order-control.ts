/*---
description: Control for revivers-depth-first-holder-order; use a plain literal at the tested route.
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
    return value;
  } };
  const value: unknown = JSON.parse('{"outer":{"leaf":' + n + '},"list":[-0,true],"tail":null}', handlers.callback);
  if (!jsonObject(value) || !jsonObject(value.outer) || !Array.isArray(value.list)) throw new Error("shape");
  const items: unknown[] = value.list, outer = "{leaf=number:" + n + "}", list = "[number:-0,boolean:true]";
  const root = "{outer=" + outer + ",list=" + list + ",tail=object:null}";
  const expected = [["leaf", "number:" + n, outer], ["outer", outer, root], ["0", "number:-0", list],
    ["1", "boolean:true", list], ["list", list, root], ["tail", "object:null", root], ["", root, "{=" + root + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(value), root); assert.compareArray(Object.keys(value), ["outer", "list", "tail"]);
  assert.compareArray(Object.keys(value.outer), ["leaf"]); assert.compareArray(Object.keys(items), ["0", "1"]);
  assert.sameValue(typeof value.outer.leaf, "number"); assert.sameValue(Object.is(value.outer.leaf, n), true);
  assert.sameValue(items.length, 2); assert.sameValue(typeof items[0], "number"); assert.sameValue(Object.is(items[0], -0), true);
  assert.sameValue(typeof items[1], "boolean"); assert.sameValue(items[1], true); assert.sameValue(typeof value.tail, "object"); assert.sameValue(value.tail, null);
  assert.compareArray(holders.slice(0, 6), [value.outer, value, items, items, value, value]);
  const wrapper = holders[6]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], value);
}
