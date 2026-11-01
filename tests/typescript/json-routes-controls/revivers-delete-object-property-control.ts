/*---
description: Control for revivers-delete-object-property; use a plain literal at the tested route.
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
    return key === "drop" ? undefined : value;
  } };
  const value: unknown = JSON.parse('{"drop":' + n + ',"keep":-0,"tail":true}', handlers.callback);
  if (!jsonObject(value)) throw new Error("shape");
  const before = "{drop=number:" + n + ",keep=number:-0,tail=boolean:true}", after = "{keep=number:-0,tail=boolean:true}";
  const expected = [["drop", "number:" + n, before], ["keep", "number:-0", after], ["tail", "boolean:true", after], ["", after, "{=" + after + "}"]];
  assert.sameValue(log.length, expected.length); assert.sameValue(holders.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.compareArray(log[i], expected[i]);
  assert.sameValue(snapshot(value), after); assert.compareArray(Object.keys(value), ["keep", "tail"]);
  assert.sameValue("drop" in value, false); assert.sameValue(typeof value.keep, "number"); assert.sameValue(Object.is(value.keep, -0), true);
  assert.sameValue(typeof value.tail, "boolean"); assert.sameValue(value.tail, true);
  assert.compareArray(holders.slice(0, 3), [value, value, value]);
  const wrapper = holders[3]; if (!jsonObject(wrapper)) throw new Error("holder");
  assert.compareArray(Object.keys(wrapper), [""]); assert.sameValue(wrapper[""], value);
}
