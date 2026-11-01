/*---
description: Control for functions-constraint-id-layouts; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unknown]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type PlainId = { id: number };
type NamedId = { name: string; id: number };
type PayloadId = { payload: unknown; active: boolean; id: number };
function choosePlain(first: PlainId, second: PlainId): PlainId { return Object.is(first.id, -0) || Number.isNaN(first.id) ? first : second; }
function chooseNamed(first: NamedId, second: NamedId): NamedId { return Object.is(first.id, -0) || Number.isNaN(first.id) ? first : second; }
function choosePayload(first: PayloadId, second: PayloadId): PayloadId { return Object.is(first.id, -0) || Number.isNaN(first.id) ? first : second; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 2.5]) {
  const takeFirst = Object.is(n, -0) || Number.isNaN(n), payload: unknown = takeFirst ? undefined : { id: n };
  const plain: PlainId = { id: n }, plainNext: PlainId = { id: 7 };
  const named: NamedId = { name: "first", id: n }, namedNext: NamedId = { name: "next", id: 7 };
  const rich: PayloadId = { payload, active: true, id: n }, richNext: PayloadId = { payload: null, active: false, id: 7 };
  const a = choosePlain(plain, plainNext), aExpected = takeFirst ? plain : plainNext;
  same(a, aExpected); same(a.id, aExpected.id);
  const b = chooseNamed(named, namedNext), bExpected = takeFirst ? named : namedNext;
  same(b, bExpected); same(b.id, bExpected.id); same(b.name, bExpected.name);
  const c = choosePayload(rich, richNext), cExpected = takeFirst ? rich : richNext;
  same(c, cExpected); same(c.id, cExpected.id); same(c.payload, cExpected.payload); same(c.active, cExpected.active);
}
