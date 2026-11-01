/*---
description: "Control for views-narrow-return-keeps-hidden-keys; A smaller optional interface return keeps hidden own keys and getters live when the caller adds and overwrites fields."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-optional-properties, ts-closures]
---*/
// A generic return erases all but optional maybe from the static view; node still enumerates hidden keys and a hidden getter reads later writes through that view. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type HiddenCell = { maybe?: ViewValue; z?: ViewValue; hidden?: ViewValue; "2"?: ViewValue; "10"?: ViewValue };
function inspect(input: ViewValue, kind: "empty" | "mixed" | "getter" | "undefined"): void {
  const log: unknown[] = [], source: HiddenCell = {}; let hasMaybe = false;
  if (kind === "mixed" || kind === "getter") { source.z = input; if (kind === "getter") source.hidden = undefined; source["10"] = marker; source["2"] = input; }
  if (kind === "undefined") { source.maybe = undefined; hasMaybe = true; }
  const view = source; same(view, source);
  function values(keys: string[]): ViewValue[] { const result: ViewValue[] = []; for (const key of keys) { let value: ViewValue = source.maybe; if (key === "2") value = source["2"]; if (key === "10") value = source["10"]; if (key === "z") value = source.z; if (key === "hidden") { value = source.maybe; log.push("hidden", value); } result.push(value); } return result; }
  const beforeKeys = kind === "empty" ? [] : kind === "undefined" ? ["maybe"] : kind === "getter" ? ["2", "10", "z", "hidden"] : ["2", "10", "z"];
  order(view, beforeKeys); const before: unknown[] = values(beforeKeys); same(hasMaybe, kind === "undefined");
  const expectedBefore: ViewValue[] = []; if (kind === "undefined") expectedBefore.push(undefined); if (kind === "mixed" || kind === "getter") expectedBefore.push(input, marker, input); if (kind === "getter") expectedBefore.push(undefined);
  assert.sameValue(before.length, expectedBefore.length); for (let at = 0; at < before.length; at++) same(before[at], expectedBefore[at]);
  source.maybe = replacement; hasMaybe = true; source["2"] = input; same(source.maybe, replacement); same(source.maybe, replacement);
  const afterKeys = kind === "empty" || kind === "undefined" ? ["2", "maybe"] : beforeKeys.concat(["maybe"]); order(source, afterKeys);
  const after: unknown[] = values(afterKeys), expectedAfter: ViewValue[] = [input]; if (kind === "mixed" || kind === "getter") expectedAfter.push(marker, input); if (kind === "getter") expectedAfter.push(replacement); expectedAfter.push(replacement);
  assert.sameValue(after.length, expectedAfter.length); for (let at = 0; at < after.length; at++) same(after[at], expectedAfter[at]);
  same(hasMaybe, true); same(source["2"], input); assert.compareArray(log, kind === "getter" ? ["hidden", undefined, "hidden", replacement] : []);
}
const kinds: ("empty" | "mixed" | "getter" | "undefined")[] = ["empty", "mixed", "getter", "undefined"];
for (const input of inputs) for (const kind of kinds) inspect(input, kind);
