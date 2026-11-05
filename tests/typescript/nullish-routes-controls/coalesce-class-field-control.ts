/*---
description: "A nullable class number field preserves signed zero. Route: class number field (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-class, ts-class-fields]
---*/

// A nullable class number field preserves signed zero. Route: class number field. Node prints coalesce-class-field:ok.
class NumberCell {
  value: number | null | undefined;
  constructor(value: number | null | undefined) { this.value = value; }
  read(): number {
    const saved = this.value; const result = saved === null || saved === undefined ? 4 : saved;
    return result;
  }
}
const rows: readonly (readonly [number | null | undefined, number])[] = [[-0, -0], [NaN, NaN], [null, 4], [undefined, 4]];
for (const [value, expected] of rows) assert.sameValue(new NumberCell(value).read(), expected);
console.log("coalesce-class-field:ok");
