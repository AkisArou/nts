/*---
description: "Control for presence-json-add-optional-snapshot; A JSON getter fills an optional slot that serializes only when its key was present in the initial snapshot."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify]
---*/
// An optional interface starts missing p or owning undefined; head writes p during JSON, so node includes its new value only for the initially present key and both shapes later enumerate p. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
function inspect(input: ObjectValue, encoded: string, present: boolean): void {
  const log: unknown[] = [];
  const source: { two: ObjectValue; tail: ObjectValue; p: ObjectValue; present: boolean; names: string[] } = { two: input, tail: other, p: undefined, present, names: present ? ["2", "head", "tail", "p"] : ["2", "head", "tail"] };
  function readHead(): string { log.push("head", input); source.p = input; source.present = true; source.names = ["2", "head", "tail", "p"]; return "H"; }
  function read(key: string): ObjectValue { if (key === "head") return readHead(); if (key === "2") return source.two; if (key === "p") return source.present ? source.p : undefined; return source.tail; }
  const before = present ? ["2", "head", "tail", "p"] : ["2", "head", "tail"], snapshot = source.names.slice();
  assert.compareArray(snapshot, before); same(source.present, present); same(source.present, present);
  const json = serialize(snapshot, read); log.push("json", json);
  const text = '{' + (input === undefined ? "" : '"2":' + encoded + ',') + '"head":"H","tail":{"id":7}' + (present && input !== undefined ? ',"p":' + encoded : "") + '}'; same(json, text);
  const names = ["2", "head", "tail", "p"], keys = source.names.slice(), visited: string[] = []; for (const key of source.names) visited.push(key);
  assert.compareArray(snapshot, before); assert.compareArray(keys, names); assert.compareArray(visited, names);
  same(source.two, input); same(source.tail, other); same(source.p, input); same(source.present, true); same(source.present, true); same(readHead(), "H");
  assert.compareArray(log, ["head", input, "json", text, "head", input]);
}
for (const sample of samples) for (const present of [false, true]) inspect(sample[0], sample[1], present);
