/*---
description: "An optional tuple argument list preserves absent versus explicit undefined arity."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples, ts-tuple-optional, ts-spread, ts-optional-parameters, ts-null-undefined, ts-unions]
---*/
// [number,string?] is spread with one or two slots; node distinguishes omitted and explicit undefined arguments while preserving each value.
type OptionalRow = { num: number; text: string | undefined; present: boolean };
const rows: OptionalRow[] = [{ num: -0, text: undefined, present: false }, { num: NaN, text: undefined, present: true }, { num: 2.5, text: "", present: true }, { num: -7, text: "tail", present: true }];
type OptionalArgs = [number, string?];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
let current: OptionalRow = rows[0];
function receive(num: number, text?: string): void { same(num, current.num); same(text, current.text); same(arguments.length, current.present ? 2 : 1); }
for (const row of rows) {
  current = row; const input: OptionalArgs = row.present ? [row.num, row.text] : [row.num];
  same(input.length, row.present ? 2 : 1); same(Array.isArray(input), true); same(input[0], row.num); same(input[1], row.text);
  receive(...input);
}
