/*---
description: "Control for presence-optional-probes-before-getter; Optional membership and ordered enumeration precede every getter read and distinguish stored undefined from absence."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify]
---*/
// A string-index interface carries empty, mixed-key, getter and frozen shapes; node keeps presence separate from value and omits undefined only from JSON. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
type ShapeMode = "empty" | "missing" | "undefined" | "value" | "getter" | "frozen";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [], present = mode !== "empty" && mode !== "missing", accessor = mode === "getter";
  const wanted = present && mode !== "undefined" ? input : undefined;
  const names = mode === "empty" ? [] : accessor ? ["2", "10", "p", "tail"] : present ? ["2", "10", "tail", "p"] : ["2", "10", "tail"];
  const expectedValues: ObjectValue[] = mode === "empty" ? [] : accessor ? [other, input, wanted, ""] : present ? [other, input, "", wanted] : [other, input, ""];
  const state = { present, accessor, p: wanted, names: names.slice(), two: other, ten: input, tail: "" };
  function readP(): ObjectValue { if (state.accessor) log.push("get", state.p); return state.present ? state.p : undefined; }
  function read(key: string): ObjectValue { if (key === "p") return readP(); if (key === "2") return state.two; if (key === "10") return state.ten; return state.tail; }
  const exists = state.present, own = state.present, legacy = state.present;
  log.push("presence", exists, own, legacy); same(exists, present); same(own, present); same(legacy, present);
  const keys = state.names.slice(), visited: string[] = []; for (const key of state.names) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names); log.push("keys");
  const optional = readP(); log.push("optional", optional); same(optional, wanted);
  for (let i = 0; i < keys.length; i++) { const value = read(keys[i]); log.push("entry", keys[i], value); same(value, expectedValues[i]); }
  const json = serialize(state.names, read); log.push("json", json);
  const stem = '{"2":{"id":7}' + (input === undefined ? "" : ',"10":' + encoded), member = wanted === undefined ? "" : ',"p":' + encoded;
  const text = mode === "empty" ? '{}' : stem + (accessor ? member : "") + ',"tail":""' + (accessor ? "" : member) + '}';
  same(json, text);
  const expected: unknown[] = ["presence", present, present, present, "keys"];
  if (accessor) expected.push("get", input); expected.push("optional", wanted);
  for (let i = 0; i < names.length; i++) { if (accessor && names[i] === "p") expected.push("get", input); expected.push("entry", names[i], expectedValues[i]); }
  if (accessor) expected.push("get", input); expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "missing", "undefined", "value", "getter", "frozen"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
