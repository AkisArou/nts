/*---
description: "Control for state-static-shadowed-map; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties, ts-map-set, ts-narrowing, ts-errors]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type StaticData = { kind: string; head: number; payload: unknown; tail?: string; token?: bigint };
const root: StaticData = { kind: "root", head: -0, payload: undefined }, child: StaticData = { kind: "child", head: -0, tail: "", payload: undefined }, leaf: StaticData = { kind: "leaf", head: -0, tail: "", token: 0n, payload: undefined };
for (let index = 0; index < values.length; index++) {
  const first = values[index], second = values[(index + 1) % values.length], third = values[(index + 2) % values.length];
  root.payload = first; child.payload = second; leaf.payload = third;
  const expected: unknown[] = [first, second, third];
  const sources: StaticData[] = [root, child, leaf];
  const names: string[] = ["root", "child", "leaf"], table = new Map<string, StaticData>();
  for (let slot = 0; slot < sources.length; slot++) table.set(names[slot], sources[slot]);
  for (let slot = 0; slot < names.length; slot++) {
    const receiver = table.get(names[slot]); if (receiver === undefined) throw new Error("constructor missing");
    same(receiver, sources[slot]); same(receiver.kind, names[slot]); same(receiver.head, -0); same(receiver.payload, expected[slot]); same(Object.hasOwn(receiver, "payload"), true);
    const replacement = values[(index + slot + 3) % values.length]; receiver.payload = replacement; expected[slot] = replacement;
    for (let other = 0; other < sources.length; other++) same(sources[other].payload, expected[other]);
  }
  same(child.tail, ""); same(leaf.tail, ""); same(leaf.token, 0n); same(table.size, 3);
}
