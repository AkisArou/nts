/*---
description: "Own-property predicates differ from in without evaluating own or inherited getters."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-literal-types, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-interfaces, ts-index-signatures, ts-optional-properties, ts-accessors, ts-closures, ts-class, ts-json-stringify]
---*/
// One optional interface receives an own getter, a class getter, data, frozen or empty shape; node reads inherited data but excludes it from own keys, for-in and JSON.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface PresenceView { [key: string]: ObjectValue; p?: ObjectValue; }
type ShapeMode = "empty" | "data" | "own" | "inherited" | "frozen";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode): void {
  const log: unknown[] = [], present = mode !== "empty", ownExpected = present && mode !== "inherited";
  class Inherited { [key: string]: ObjectValue; get p(): ObjectValue { log.push("get", input); return input; } }
  let source: PresenceView = {};
  if (mode === "inherited") { source = new Inherited(); source["2"] = other; source.tail = ""; }
  else if (mode === "data") source = { "2": other, p: input, tail: "" };
  else if (present) source = { "2": other, get p(): ObjectValue { log.push("get", input); return input; }, tail: "" };
  if (mode === "frozen") Object.freeze(source);
  const names = !present ? [] : ownExpected ? ["2", "p", "tail"] : ["2", "tail"];
  const exists = "p" in source, own = Object.hasOwn(source, "p"), legacy = Object.prototype.hasOwnProperty.call(source, "p");
  same(exists, present); same(own, ownExpected); same(legacy, ownExpected); log.push("presence", exists, own, legacy);
  const keys = Object.keys(source), visited: string[] = []; for (const key in source) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names); log.push("keys");
  const value = source.p; same(value, present ? input : undefined); log.push("read", value);
  if (present) { same(source["2"], other); same(source.tail, ""); }
  const json = JSON.stringify(source); log.push("json", json);
  const text = !present ? '{}' : '{"2":{"id":7}' + (ownExpected && input !== undefined ? ',"p":' + encoded : "") + ',"tail":""}'; same(json, text);
  const expected: unknown[] = ["presence", present, ownExpected, ownExpected, "keys"];
  if (present && mode !== "data") expected.push("get", input); expected.push("read", present ? input : undefined);
  if (mode === "own" || mode === "frozen") expected.push("get", input); expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "data", "own", "inherited", "frozen"];
for (const sample of samples) for (const mode of modes) inspect(sample[0], sample[1], mode);
