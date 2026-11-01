/*---
description: "An in guard after conditional deletion selects the current optional member instead of a stale narrowed branch."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-optional-properties, ts-accessors, ts-closures, ts-narrowing, ts-json-stringify, ts-expressions, ts-literal-types]
---*/
// A declared object union is checked, optionally deleted and checked again; node distinguishes retained undefined, removed getters and the other union member with exact JSON and ordered keys.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type PresenceShape = { p?: ObjectValue; tail: ObjectValue } | { other: ObjectValue; tail: ObjectValue };
type ShapeMode = "absent" | "undefined" | "value" | "getter" | "other";
function inspect(input: ObjectValue, encoded: string, mode: ShapeMode, remove: boolean): void {
  const log: unknown[] = []; let source: PresenceShape = { tail: other };
  if (mode === "undefined") source = { p: undefined, tail: other };
  if (mode === "value") source = { p: input, tail: other };
  if (mode === "getter") source = { get p(): ObjectValue { log.push("get", input); return input; }, tail: other };
  if (mode === "other") source = { other: input, tail: other };
  const initial = mode !== "absent" && mode !== "other", present = initial && !remove, wanted = mode === "undefined" ? undefined : input;
  if ("p" in source) { log.push("before:present"); if (remove) { same(delete source.p, true); log.push("delete"); } }
  else log.push("before:absent");
  let actual: ObjectValue = undefined;
  if ("p" in source) { actual = source.p; log.push("after:present", actual); }
  else log.push("after:absent", actual);
  if ("other" in source) same(source.other, input);
  same(actual, present ? wanted : undefined); same(Object.hasOwn(source, "p"), present); same(source.tail, other);
  const names = mode === "other" ? ["other", "tail"] : present ? ["p", "tail"] : ["tail"], keys = Object.keys(source), visited: string[] = []; for (const key in source) visited.push(key);
  assert.compareArray(keys, names); assert.compareArray(visited, names);
  const json = JSON.stringify(source), field = mode === "other" ? (input === undefined ? "" : '"other":' + encoded + ',') : present && wanted !== undefined ? '"p":' + encoded + ',' : "";
  const text = '{' + field + '"tail":{"id":7}}'; same(json, text); log.push("json", json);
  const expected: unknown[] = [initial ? "before:present" : "before:absent"];
  if (initial && remove) expected.push("delete"); if (present && mode === "getter") expected.push("get", input);
  expected.push(present ? "after:present" : "after:absent", present ? wanted : undefined);
  if (present && mode === "getter") expected.push("get", input); expected.push("json", text); assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["absent", "undefined", "value", "getter", "other"];
for (const sample of samples) for (const mode of modes) for (const remove of [false, true]) inspect(sample[0], sample[1], mode, remove);
