/*---
description: "Control for assignments-postincrement-accessor-conversion; Postfix accessor increment keeps its reference through conversion effects and returns the old numeric value."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-objects, ts-accessors, ts-this, ts-closures, ts-unsound-object-assign, ts-conversions, ts-to-primitive, ts-literal-types, ts-unions, ts-typeof-operator]
---*/
// An interface number accessor carries ++ after an ordinary Object.assign widening; node logs getter, numeric conversion, then one original setter and returns the old number. The control saves each step in order.
const log: string[] = [];
interface Cell { id: string; raw: number; x: number; }
for (const kind of ["primitive", "valueOf", "fallback"]) for (const initial of [-2, -0, 4]) {
  const view: { value: number } = { value: initial };
  const cell: Cell = { id: "first", raw: 0, get x(): number { log.push("get:first"); return view.value; }, set x(value: number) { log.push(`set:first:${value}`); this.raw = value + 10; } };
  const other: Cell = { id: "other", raw: 90, x: 90 }; let active: Cell = cell;
  class Hook {
    valueOf(): number | object { log.push("valueOf"); cell.raw = 99; active = other; return kind === "fallback" ? this : initial; }
    toString(): string { log.push("toString"); return Object.is(initial, -0) ? "-0" : String(initial); }
  }
  if (kind !== "primitive") Object.assign(view, { value: new Hook() });
  function target(): Cell { log.push(`target:${active.id}`); return active; }
  function key(): "x" { log.push("key"); return "x"; }
  function run(): number { log.push("run"); const receiver = target();
    const propertyKey = key();
    const before = receiver[propertyKey];
    let numeric = before;
    const result = numeric++;
    receiver[propertyKey] = numeric;
    return result; }
  log.length = 0; const result = run();
  const expected = ["run", "target:first", "key", "get:first"];
  if (kind !== "primitive") expected.push("valueOf"); if (kind === "fallback") expected.push("toString"); expected.push(`set:first:${initial + 1}`);
  assert.compareArray(log, expected);
  assert.sameValue(result, initial); assert.sameValue(typeof result, "number"); assert.sameValue(cell.raw, initial + 11);
  assert.sameValue(other.raw, 90); assert.sameValue(other.x, 90); assert.sameValue(active, kind === "primitive" ? cell : other);
}
