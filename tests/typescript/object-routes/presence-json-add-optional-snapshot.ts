/*---
description: "A JSON getter fills an optional slot that serializes only when its key was present in the initial snapshot."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-interfaces, ts-index-signatures, ts-optional-properties, ts-accessors, ts-closures, ts-json-stringify]
---*/
// An optional interface starts missing p or owning undefined; head writes p during JSON, so node includes its new value only for the initially present key and both shapes later enumerate p.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface PresenceView { [key: string]: ObjectValue; p?: ObjectValue; }
function inspect(input: ObjectValue, encoded: string, present: boolean): void {
  const log: unknown[] = [];
  const source: PresenceView = { "2": input, get head(): ObjectValue { log.push("head", input); source.p = input; return "H"; }, tail: other };
  if (present) source.p = undefined;
  const before = present ? ["2", "head", "tail", "p"] : ["2", "head", "tail"], snapshot = Object.keys(source);
  assert.compareArray(snapshot, before); same("p" in source, present); same(Object.hasOwn(source, "p"), present);
  const json = JSON.stringify(source); log.push("json", json);
  const text = '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"head":"H","tail":{"id":7}' + (present && input !== undefined ? ',"p":' + encoded : "") + '}'; same(json, text);
  const names = ["2", "head", "tail", "p"], keys = Object.keys(source), visited: string[] = []; for (const key in source) visited.push(key);
  assert.compareArray(snapshot, before); assert.compareArray(keys, names); assert.compareArray(visited, names);
  same(source["2"], input); same(source.tail, other); same(source.p, input); same("p" in source, true); same(Object.hasOwn(source, "p"), true); same(source.head, "H");
  assert.compareArray(log, ["head", input, "json", text, "head", input]);
}
for (const sample of samples) for (const present of [false, true]) inspect(sample[0], sample[1], present);
