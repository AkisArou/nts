/*---
description: "A constructor Map preserves independent shadowed static fields across runtime representations."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-typeof-type, ts-map-set, ts-narrowing, ts-errors]
---*/
// StaticRoot, StaticChild and StaticLeaf shadow payload in different static layouts; a Map<string, typeof StaticRoot> writes each constructor while every other slot keeps its own exact value.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
class StaticRoot { static kind: string = "root"; static head: number = -0; static payload: unknown = undefined; }
class StaticChild extends StaticRoot { static override kind: string = "child"; static tail: string = ""; static override payload: unknown = undefined; }
class StaticLeaf extends StaticChild { static override kind: string = "leaf"; static token: bigint = 0n; static override payload: unknown = undefined; }
for (let index = 0; index < values.length; index++) {
  const first = values[index], second = values[(index + 1) % values.length], third = values[(index + 2) % values.length];
  StaticRoot.payload = first; StaticChild.payload = second; StaticLeaf.payload = third;
  const expected: unknown[] = [first, second, third];
  const sources: (typeof StaticRoot)[] = [StaticRoot, StaticChild, StaticLeaf];
  const names: string[] = ["root", "child", "leaf"], table = new Map<string, typeof StaticRoot>();
  for (let slot = 0; slot < sources.length; slot++) table.set(names[slot], sources[slot]);
  for (let slot = 0; slot < names.length; slot++) {
    const receiver = table.get(names[slot]); if (receiver === undefined) throw new Error("constructor missing");
    same(receiver, sources[slot]); same(receiver.kind, names[slot]); same(receiver.head, -0); same(receiver.payload, expected[slot]); same(Object.hasOwn(receiver, "payload"), true);
    const replacement = values[(index + slot + 3) % values.length]; receiver.payload = replacement; expected[slot] = replacement;
    for (let other = 0; other < sources.length; other++) same(sources[other].payload, expected[other]);
  }
  same(StaticChild.tail, ""); same(StaticLeaf.tail, ""); same(StaticLeaf.token, 0n); same(table.size, 3);
}
