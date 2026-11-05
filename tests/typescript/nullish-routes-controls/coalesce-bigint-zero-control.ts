/*---
description: "Coalescing keeps a zero bigint class field. Route: class field (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-class, ts-class-fields]
---*/

// Coalescing keeps a zero bigint class field. Route: class field. Node prints coalesce-bigint-zero:ok.
class Cell {
  value: bigint | null | undefined;
  constructor(value: bigint | null | undefined) { this.value = value; }
  read(): bigint {
    const saved = this.value; const result = saved === null || saved === undefined ? 5n : saved;
    return result;
  }
}
for (const [value, expected] of [[0n, 0n], [-3n, -3n], [null, 5n], [undefined, 5n]] as const) {
  assert.sameValue(new Cell(value).read(), expected);
}
console.log("coalesce-bigint-zero:ok");
