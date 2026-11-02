/*---
description: "A returned heterogeneous enum tuple preserves numeric and textual values even when both select the same reverse property."
features: [ts-enum-computed, ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-enum, ts-enum-string, ts-enum-reverse-mapping, ts-tuples, ts-record, ts-unions, ts-null-undefined]
---*/
// Each MixedChoice member crosses a typed tuple parameter and return; node keeps tuple identity, distinguishes 0 from "0", and reports the last numeric alias name.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum MixedChoice { Zero = 0, Empty = "", TextZero = "0", Two = 2, TextTwo = "2", Again = Zero, Tail = "tail" }
function carry(pair: readonly [MixedChoice, string], log: unknown[]): readonly [MixedChoice, string] { log.push("tuple", pair[0], typeof pair[0], pair[1]); return pair; }
const values: MixedChoice[] = [MixedChoice.Zero, MixedChoice.Empty, MixedChoice.TextZero, MixedChoice.Two, MixedChoice.TextTwo, MixedChoice.Again, MixedChoice.Tail];
const expected: (number | string)[] = [0, "", "0", 2, "2", 0, "tail"], reverses: (string | undefined)[] = ["Again", undefined, "Again", "Two", "Two", "Again", undefined];
const labels = ["zero", "empty", "text-zero", "two", "text-two", "again", "tail"], view: Readonly<Record<string, string | number | undefined>> = MixedChoice;
exact(Object.keys(view), ["0", "2", "Zero", "Empty", "TextZero", "Two", "TextTwo", "Again", "Tail"]);
exact(Object.values(view), ["Again", "Two", 0, "", "0", 2, "2", 0, "tail"]);
exact(Object.entries(view).flat(), ["0", "Again", "2", "Two", "Zero", 0, "Empty", "", "TextZero", "0", "Two", 2, "TextTwo", "2", "Again", 0, "Tail", "tail"]);
for (let at = 0; at < values.length; at++) {
  const pair: readonly [MixedChoice, string] = [values[at], labels[at]], log: unknown[] = [], result = carry(pair, log);
  const reverse = view[result[0]]; log.push("reverse", reverse, "result", result[0], result[1]);
  same(result, pair); same(result[0], expected[at]); same(result[1], labels[at]); same(reverse, reverses[at]);
  exact(log, ["tuple", expected[at], typeof expected[at], labels[at], "reverse", reverses[at], "result", expected[at], labels[at]]);
}
