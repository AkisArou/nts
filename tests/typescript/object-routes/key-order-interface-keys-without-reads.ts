/*---
description: "Interface key enumeration sorts index boundaries without invoking own getters."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-interfaces, ts-index-signatures, ts-optional-properties, ts-accessors, ts-numbers, ts-null-undefined]
---*/
// Optional interface shapes cross inspect; node lists keys without reads, then explicit value reads invoke each getter once.
interface KeyView { [key: string]: unknown; value?: unknown; }
type KeyRow = { view: KeyView; names: string[]; values: unknown[]; calls: string[] };
const events: string[] = [], reference = { id: 7 };
function sameKeyValue(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspectKeys(view: KeyView, row: KeyRow): void {
  const keys = Object.keys(view), traversed: string[] = [];
  for (const key in view) traversed.push(key);
  assert.compareArray(keys, row.names); assert.compareArray(traversed, row.names); assert.compareArray(events, []);
  const values: unknown[] = []; for (const key of keys) values.push(view[key]);
  assert.sameValue(values.length, row.values.length);
  for (let i = 0; i < values.length; i++) sameKeyValue(values[i], row.values[i]);
  assert.compareArray(events, row.calls);
}
const rows: KeyRow[] = [
  { view: {}, names: [], values: [], calls: [] },
  { view: { value: undefined }, names: ["value"], values: [undefined], calls: [] },
  { view: { tail: reference, "4294967295": null, "00": "", "4294967294": NaN, "-0": -0, "0": undefined, "1.0": true }, names: ["0", "4294967294", "tail", "4294967295", "00", "-0", "1.0"], values: [undefined, NaN, reference, null, "", -0, true], calls: [] },
  { view: { tail: null, get "2"() { events.push("get:2"); return reference; }, get value() { events.push("get:value"); return -0; } }, names: ["2", "tail", "value"], values: [reference, null, -0], calls: ["get:2", "get:value"] },
  { view: Object.freeze({ z: NaN, "10": -0, a: undefined, "2": "" }), names: ["2", "10", "z", "a"], values: ["", -0, NaN, undefined], calls: [] }
];
for (const row of rows) { events.length = 0; inspectKeys(row.view, row); }
