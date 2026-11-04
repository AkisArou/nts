/*---
description: "Control for assignments-simple-rhs-abrupt; A throwing simple-assignment RHS preserves target effects and skips object-key conversion and the setter."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-index-signatures, ts-class, ts-objects, ts-accessors, ts-this, ts-closures, ts-unsound-object-assign, ts-conversions, ts-to-primitive, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-instanceof, ts-typeof-operator]
---*/
// An interface target and widened object key carry =; node evaluates target/key/RHS, preserves its mutation on RangeError, and converts the key only on the successful path. The control saves each step in order.
const log: string[] = [];
interface Cell { raw: number; x: number; [key: string]: number; }
for (const fail of [false, true]) for (const value of [-2, 0, 7]) {
  let phase = "before";
  class Key { toString(): string { log.push(`convert:${phase}`); return "x"; } }
  const keySlot: { key: string } = { key: "x" }; Object.assign(keySlot, { key: new Key() });
  const cell: Cell = { raw: 1, get x(): number { log.push("get"); return this.raw; }, set x(next: number) { log.push(`set:${next}`); this.raw = next * 2; } };
  const other: Cell = { raw: 90, x: 90 }, failure = new RangeError("rhs"); let active: Cell = cell;
  function target(): Cell { log.push("target"); return active; }
  function key(): string { log.push("key"); return keySlot.key; }
  function rhs(): number { log.push("rhs"); cell.raw = 99; phase = "rhs"; active = other; if (fail) throw failure; return value; }
  function run(): number { log.push("run"); const receiver = target();
    const referenceKey = key();
    const value = rhs();
    const propertyKey = String(referenceKey);
    receiver[propertyKey] = value;
    return value; }
  log.length = 0; let result: number | undefined; let caught: unknown; try { result = run(); } catch (error) { log.push("caught"); caught = error; }
  const expected = ["run", "target", "key", "rhs"]; if (fail) expected.push("caught"); else expected.push("convert:rhs", `set:${value}`);
  assert.compareArray(log, expected);
  assert.sameValue(caught, fail ? failure : undefined); assert.sameValue(caught instanceof RangeError, fail);
  assert.sameValue(result, fail ? undefined : value); assert.sameValue(typeof result, fail ? "undefined" : "number");
  assert.sameValue(cell.raw, fail ? 99 : value * 2); assert.sameValue(other.raw, 90); assert.sameValue(other.x, 90); assert.sameValue(active, other); assert.sameValue(phase, "rhs");
}
