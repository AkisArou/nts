/*---
description: "Control for spread-rest-spread-shape-order; Generic spread follows own integer and string key order across empty, accessor, frozen and optional shapes."
features: [ts-object-routes, ts-object-route-spread-rest, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-record, ts-generics, ts-generic-constraints, ts-accessors, ts-optional-properties]
---*/
// A generic Record consumer copies each source into writable data; node logs integer getters before string getters and distinguishes absent option from present undefined. The control copies fields explicitly from the fixture key/presence data.
type CopyValue = number | string | boolean | undefined | null | { id: number };
const first = { id: 7 }, second = { id: 7 }, replacement = { id: 99 };
const inputs: CopyValue[] = [-0, NaN, "", "tail", undefined, null, false, first, second];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type CopyRecord = Record<string, CopyValue>;
function copyOf<T extends CopyRecord>(source: T, keys: string[]): CopyRecord { const copy: CopyRecord = {}; for (const key of keys) copy[key] = source[key]; return copy; }
function inspect(input: CopyValue): void {
  const log: unknown[] = [], plain: CopyRecord = { z: input, "10": replacement, "2": input, "01": undefined, a: null };
  const getters: CopyRecord = { get z(): CopyValue { log.push("get.z", input); return input; }, get 10(): CopyValue { log.push("get.10", replacement); return replacement; },
    get 2(): CopyValue { log.push("get.2", input); return input; }, get "01"(): CopyValue { log.push("get.01", undefined); return undefined; }, get a(): CopyValue { log.push("get.a", null); return null; } };
  const absent: { option?: CopyValue } = {}, present: { option?: CopyValue } = { option: undefined };
  const rows: { source: CopyRecord; keys: string[]; values: CopyValue[]; events: unknown[] }[] = [
    { source: {}, keys: [], values: [], events: [] }, { source: plain, keys: ["2", "10", "z", "01", "a"], values: [input, replacement, input, undefined, null], events: [] },
    { source: getters, keys: ["2", "10", "z", "01", "a"], values: [input, replacement, input, undefined, null], events: ["get.2", input, "get.10", replacement, "get.z", input, "get.01", undefined, "get.a", null] },
    { source: Object.freeze({ z: input, "10": replacement, "2": input, "01": undefined, a: null }), keys: ["2", "10", "z", "01", "a"], values: [input, replacement, input, undefined, null], events: [] },
    { source: absent, keys: [], values: [], events: [] }, { source: present, keys: ["option"], values: [undefined], events: [] }
  ];
  for (const row of rows) {
    log.length = 0; const copy = copyOf(row.source, row.keys); order(copy, row.keys); order(row.source, row.keys); same(Object.is(copy, row.source), false);
    for (let at = 0; at < row.keys.length; at++) { same(copy[row.keys[at]], row.values[at]); same(Object.hasOwn(copy, row.keys[at]), true); }
    same(Object.hasOwn(copy, "option"), row.keys.indexOf("option") >= 0); same(Object.isFrozen(copy), false);
    copy.late = replacement; same(copy.late, replacement); order(copy, row.keys.concat(["late"])); same(Object.hasOwn(row.source, "late"), false);
    assert.compareArray(log, row.events);
  }
}
for (const input of inputs) inspect(input);
