/*---
description: One Cell is read and replaced through number, union and unknown class instantiations.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-objects, ts-unions, ts-unknown, ts-null-undefined, ts-arrays, ts-structural-typing, ts-unsound-generic-widening]
---*/
// Cell<number> reaches Cell<number|string> and Cell<unknown>; node keeps each string, object, undefined, -0 and NaN store visible through all three method and field views.
class Cell<T> {
  value: T; constructor(value: T) { this.value = value; }
  read(): T { return this.value; }
  replace(next: T): T { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const text = "value:" + String(n), point = { id: n };
  const source = new Cell<number>(n);
  const mixed: Cell<number | string> = source;
  const erased: Cell<unknown> = source;
  same(source, mixed); same(source, erased);
  for (const actual of [source.read(), mixed.read(), erased.read()]) same(actual, n);
  same(mixed.replace(text), n);
  for (const actual of [source.read(), mixed.read(), erased.read()]) same(actual, text);
  let previous: unknown = text;
  for (const next of [point, undefined, -0, NaN]) {
    same(erased.replace(next), previous);
    for (const actual of [source.read(), mixed.read(), erased.read(), source.value, mixed.value, erased.value]) same(actual, next);
    previous = next;
  }
}
