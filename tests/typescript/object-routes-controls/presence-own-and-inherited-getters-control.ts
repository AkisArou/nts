/*---
description: "Control for presence-own-and-inherited-getters; Own-property predicates differ from in without evaluating own or inherited getters."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-function-types, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-json-stringify]
---*/
// One optional interface receives an own getter, a class getter, data, frozen or empty shape; node reads inherited data but excludes it from own keys, for-in and JSON. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function serialize(names: string[], read: (key: string) => ObjectValue): string { const parts: string[] = []; for (const key of names) { const value = read(key), text = JSON.stringify(value); if (text !== undefined) parts.push(JSON.stringify(key) + ":" + text); } return "{" + parts.join(",") + "}"; }
type ShapeMode = "empty" | "data" | "own" | "inherited" | "frozen";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [], present = mode !== "empty", ownExpected = present && mode !== "inherited";
  const names = !present ? [] : ownExpected ? ["2", "p", "tail"] : ["2", "tail"];
  const state = { present, own: ownExpected, accessor: present && mode !== "data", p: input, two: other, tail: "", names: names.slice() };
  function readP(): ObjectValue { if (state.accessor) log.push("get", state.p); return state.present ? state.p : undefined; }
  function read(key: string): ObjectValue { if (key === "p") return readP(); if (key === "2") return state.two; return state.tail; }
  const exists = state.present, own = state.own, legacy = state.own;
  same(exists, present); same(own, ownExpected); same(legacy, ownExpected); log.push("presence", exists, own, legacy);
  const keys = state.names.slice(), visited: string[] = []; for (const key of state.names) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names); log.push("keys");
  const value = readP(); same(value, present ? input : undefined); log.push("read", value);
  if (present) { same(state.two, other); same(state.tail, ""); }
  const json = serialize(state.names, read); log.push("json", json);
  const text = !present ? '{}' : '{"2":{"id":7}' + (ownExpected && input !== undefined ? ',"p":' + encoded : "") + ',"tail":""}';
  same(json, text);
  const expected: unknown[] = ["presence", present, ownExpected, ownExpected, "keys"];
  if (present && mode !== "data") expected.push("get", input); expected.push("read", present ? input : undefined);
  if (mode === "own" || mode === "frozen") expected.push("get", input); expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "data", "own", "inherited", "frozen"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
