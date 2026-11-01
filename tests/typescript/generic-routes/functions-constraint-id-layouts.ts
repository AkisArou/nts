/*---
description: One id-constrained function selects and returns objects with three different concrete field layouts.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-generic-constraints, ts-unknown, ts-generics]
---*/
// The id constraint is read at PlainId, NamedId and PayloadId; node selects the same object by -0/NaN and preserves all observed fields.
type PlainId = { id: number };
type NamedId = { name: string; id: number };
type PayloadId = { payload: unknown; active: boolean; id: number };
function choose<T extends { id: number }>(first: T, second: T): T { return Object.is(first.id, -0) || Number.isNaN(first.id) ? first : second; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 2.5]) {
  const takeFirst = Object.is(n, -0) || Number.isNaN(n), payload: unknown = takeFirst ? undefined : { id: n };
  const plain: PlainId = { id: n }, plainNext: PlainId = { id: 7 };
  const named: NamedId = { name: "first", id: n }, namedNext: NamedId = { name: "next", id: 7 };
  const rich: PayloadId = { payload, active: true, id: n }, richNext: PayloadId = { payload: null, active: false, id: 7 };
  const a = choose<PlainId>(plain, plainNext), aExpected = takeFirst ? plain : plainNext;
  same(a, aExpected); same(a.id, aExpected.id);
  const b = choose<NamedId>(named, namedNext), bExpected = takeFirst ? named : namedNext;
  same(b, bExpected); same(b.id, bExpected.id); same(b.name, bExpected.name);
  const c = choose<PayloadId>(rich, richNext), cExpected = takeFirst ? rich : richNext;
  same(c, cExpected); same(c.id, cExpected.id); same(c.payload, cExpected.payload); same(c.active, cExpected.active);
}
