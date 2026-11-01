/*---
description: "A smaller optional interface return keeps hidden own keys and getters live when the caller adds and overwrites fields."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-literal-types, ts-interfaces, ts-index-signatures, ts-generics, ts-generic-constraints, ts-accessors, ts-structural-typing, ts-optional-properties]
---*/
// A generic return erases all but optional maybe from the static view; node still enumerates hidden keys and a hidden getter reads later writes through that view.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface SmallView { maybe?: ViewValue }
interface HiddenView extends SmallView { [key: string]: ViewValue }
function smaller<T extends HiddenView>(source: T): SmallView { return source; }
function inspect(input: ViewValue, kind: "empty" | "mixed" | "getter" | "undefined"): void {
  const log: unknown[] = []; let source: HiddenView = {};
  if (kind === "mixed") source = { z: input, "10": marker, "2": input };
  if (kind === "getter") source = { z: input, get hidden(): ViewValue { log.push("hidden", this.maybe); return this.maybe; }, "10": marker, "2": input };
  if (kind === "undefined") source = { maybe: undefined };
  const view = smaller(source); same(view, source);
  const beforeKeys = kind === "empty" ? [] : kind === "undefined" ? ["maybe"] : kind === "getter" ? ["2", "10", "z", "hidden"] : ["2", "10", "z"];
  order(view, beforeKeys); const before: unknown[] = Object.values(view); same(Object.hasOwn(view, "maybe"), kind === "undefined");
  const expectedBefore: ViewValue[] = []; if (kind === "undefined") expectedBefore.push(undefined); if (kind === "mixed" || kind === "getter") expectedBefore.push(input, marker, input); if (kind === "getter") expectedBefore.push(undefined);
  assert.sameValue(before.length, expectedBefore.length); for (let at = 0; at < before.length; at++) same(before[at], expectedBefore[at]);
  view.maybe = replacement; source["2"] = input; same(source.maybe, replacement); same(view.maybe, replacement);
  const afterKeys = kind === "empty" || kind === "undefined" ? ["2", "maybe"] : beforeKeys.concat(["maybe"]); order(view, afterKeys);
  const after: unknown[] = Object.values(view), expectedAfter: ViewValue[] = [input]; if (kind === "mixed" || kind === "getter") expectedAfter.push(marker, input); if (kind === "getter") expectedAfter.push(replacement); expectedAfter.push(replacement);
  assert.sameValue(after.length, expectedAfter.length); for (let at = 0; at < after.length; at++) same(after[at], expectedAfter[at]);
  same(Object.hasOwn(view, "maybe"), true); same(source["2"], input); assert.compareArray(log, kind === "getter" ? ["hidden", undefined, "hidden", replacement] : []);
}
const kinds: ("empty" | "mixed" | "getter" | "undefined")[] = ["empty", "mixed", "getter", "undefined"];
for (const input of inputs) for (const kind of kinds) inspect(input, kind);
