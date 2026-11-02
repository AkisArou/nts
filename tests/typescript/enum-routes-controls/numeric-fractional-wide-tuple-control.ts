/*---
description: "Explicit-object control: Negative, fractional and wide auto-incremented members retain exact values through a tuple parameter and return."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-objects, ts-record, ts-unions, ts-literal-types]
---*/
// Scale includes -3, -2, 0.5, 1.5 and a successor at 2^53 that shares its predecessor value; node keeps tuple labels and uses SameWide as the shared reverse name. The control uses frozen forward members and a separate explicit reverse map.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Scale = -3 | -2 | 0.5 | 1.5 | 9007199254740992;
const Scale = Object.freeze({ Below: -3, Above: -2, Half: 0.5, NextHalf: 1.5, Wide: 9007199254740992, SameWide: 9007199254740992 });
const ScaleReverse: Readonly<Record<number, string | undefined>> = Object.freeze({ "-3": "Below", "-2": "Above", "0.5": "Half", "1.5": "NextHalf", 9007199254740992: "SameWide" });
type Packet = [string, Scale];
function pass(packet: Packet): Packet { return packet; }
const rows: [Scale, number, string][] = [[Scale.Below, -3, "Below"], [Scale.Above, -2, "Above"], [Scale.Half, 0.5, "Half"], [Scale.NextHalf, 1.5, "NextHalf"], [Scale.Wide, 9007199254740992, "SameWide"], [Scale.SameWide, 9007199254740992, "SameWide"]];
for (const [value, expected, name] of rows) {
  const packet: Packet = [name, value]; const result: Packet = pass(packet);
  same(result, packet); exact(result, [name, expected]); same(result[1], expected); same(ScaleReverse[result[1]], name);
  same(pass(result)[1], expected); same(packet[0], name);
}
