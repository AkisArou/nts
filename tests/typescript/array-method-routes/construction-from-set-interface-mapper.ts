/*---
description: "Array.from maps each unique Set value with its insertion-order index through two providers."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-map-set, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions]
---*/

// Array.from maps each unique Set value with its insertion-order index through two providers. Route: an interface with two Set implementations. Node prints construction-from-set-interface-mapper:ok.
interface FromSetPort { read(): Set<number>; }
class FirstSet implements FromSetPort {
  values: Set<number> = new Set([2, 2, 5]); read(): Set<number> { return this.values; }
}
class SecondSet implements FromSetPort {
  values: Set<number> = new Set([-1, 4, -1]); read(): Set<number> { return this.values; }
}
const rows: readonly [FromSetPort, readonly number[]][] = [[new FirstSet(), [20, 51]], [new SecondSet(), [-10, 41]]];
for (const [port, expected] of rows) {
  const source = port.read(), result = Array.from(source, (value, index) => value * 10 + index);
  assert.compareArray(result, expected);
  source.clear(); assert.compareArray(result, expected); assert.sameValue(source.size, 0);
}
console.log("construction-from-set-interface-mapper:ok");
