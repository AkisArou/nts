/*---
description: "Explicit conversion control: A constrained generic substitution uses the string hint and skips ordinary fallback hooks."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-interfaces, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-bigint, ts-null-undefined, ts-tuples, ts-to-string, ts-to-primitive, ts-this, ts-closures, ts-symbols, ts-computed-keys, ts-generics, ts-generic-constraints, ts-literal-types]
---*/
// A generic field carries a Symbol.toPrimitive object; node requests string once, preserves its receiver and uses the primitive result without toString or valueOf. The control uses ordered String calls and concatenation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type Scalar = string | number | boolean | bigint | null | undefined;

type Hint = "string" | "number" | "default";
interface PrimitiveHook { value: Scalar; [Symbol.toPrimitive](hint: Hint): Scalar; toString(): string; valueOf(): number; }
const rows: [Scalar, string][] = [["", ""], [-0, "0"], [NaN, "NaN"], [1e21, "1e+21"], [1e-7, "1e-7"], [12n, "12"], [null, "null"], [undefined, "undefined"], [true, "true"]];
const log: unknown[] = [];
function render<T extends PrimitiveHook>(box: { label: string; item: T }, index: number): string {
  same(box.item.value, rows[index][0]); return "<" + String(box.item) + ">";
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index]; log.length = 0;
  const value: PrimitiveHook = {
    value: row[0],
    [Symbol.toPrimitive](hint: Hint): Scalar { log.push(this, hint, arguments.length, this.value); return hint === "string" ? this.value : "wrong-hint"; },
    toString(): string { log.push("toString"); return "wrong-toString"; },
    valueOf(): number { log.push("valueOf"); return 9; },
  };
  const box = { label: "padding", item: value };
  assert.sameValue(render(box, index), "<" + row[1] + ">"); same(box.item, value); same(value.value, row[0]);
  assert.compareArray(log, [value, "string", 1, row[0]]);
}
