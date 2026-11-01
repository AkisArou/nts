/*---
description: "Control for calls-optional-spread-arity; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-null-undefined, ts-unions]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type OptionalRow = { num: number; text: string | undefined; present: boolean };
const rows: OptionalRow[] = [{ num: -0, text: undefined, present: false }, { num: NaN, text: undefined, present: true }, { num: 2.5, text: "", present: true }, { num: -7, text: "tail", present: true }];
type OptionalArgs = { first: number; second: string | undefined; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
let current: OptionalRow = rows[0];
function receive(num: number, text: string | undefined, count: number): void { same(num, current.num); same(text, current.text); same(count, current.present ? 2 : 1); }
for (const row of rows) {
  current = row; const input: OptionalArgs = { first: row.num, second: row.text, count: row.present ? 2 : 1, array: true };
  same(input.count, row.present ? 2 : 1); same(input.array, true); same(input.first, row.num); same(input.second, row.text);
  receive(input.first, input.second, input.count);
}
