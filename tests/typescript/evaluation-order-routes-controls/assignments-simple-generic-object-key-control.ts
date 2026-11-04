/*---
description: "Control for assignments-simple-generic-object-key; Computed assignment delays an object key conversion until after an RHS that changes its spelling."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-generics, ts-generic-constraints, ts-class, ts-class-fields, ts-objects, ts-closures, ts-unsound-object-assign, ts-conversions, ts-to-primitive, ts-literal-types, ts-unions, ts-index-signatures, ts-this, ts-typeof-operator]
---*/
// A generic target and Object.assign-widened key carry =; node evaluates target/key/RHS before toString and writes the RHS-selected property. The control saves each step in order.
const log: string[] = [];
interface Cell { x: number; y: number; [key: string]: number; }
interface Key { spelling: string; toString(): string; }
class Name implements Key {
  spelling: string = "x";
  toString(): string { log.push(`toString:${this.spelling}`); return this.spelling; }
}
function target<T extends Cell>(cell: T): Cell { log.push("target"); return cell; }
for (const kind of ["class", "literal", "primitive"]) for (const value of [-4, 0, 7]) {
  const cell: Cell = { x: 1, y: 2 };
  const token: Key = kind === "class" ? new Name() : { spelling: "x", toString(): string { log.push(`toString:${this.spelling}`); return this.spelling; } };
  const holder: { key: string } = { key: "x" };
  if (kind !== "primitive") Object.assign(holder, { key: token });
  function key(): string { log.push("key"); return holder.key; }
  function rhs(): number { log.push("rhs"); token.spelling = "y"; cell.x = 100; return value; }
  function run(): number { log.push("run"); const receiver = target(cell);
    const referenceKey = key();
    const value = rhs();
    const propertyKey = String(referenceKey);
    receiver[propertyKey] = value;
    return value; }
  log.length = 0; const result = run();
  const expected = ["run", "target", "key", "rhs"]; if (kind !== "primitive") expected.push("toString:y");
  assert.compareArray(log, expected);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(cell.x, kind === "primitive" ? value : 100); assert.sameValue(cell.y, kind === "primitive" ? 2 : value);
  assert.sameValue(token.spelling, "y"); assert.sameValue(holder.key, kind === "primitive" ? "x" : token);
}
