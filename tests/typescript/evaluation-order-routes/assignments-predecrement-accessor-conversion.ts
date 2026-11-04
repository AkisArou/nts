/*---
description: "Prefix accessor decrement uses the number hint and returns the computed number before setter transformation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-objects, ts-accessors, ts-this, ts-closures, ts-unsound-object-assign, ts-conversions, ts-to-primitive, ts-symbols, ts-computed-keys, ts-typeof-operator]
---*/
// An interface accessor carries -- over an Object.assign-widened conversion object; node calls Symbol.toPrimitive with number before writing the original receiver.
const log: string[] = [];
interface Cell { id: string; raw: number; x: number; }
for (const hooked of [false, true]) for (const initial of [-2, 0, 4]) {
  const view: { value: number } = { value: initial };
  const cell: Cell = { id: "first", raw: 0, get x(): number { log.push("get:first"); return view.value; }, set x(value: number) { log.push(`set:first:${value}`); this.raw = -value; } };
  const other: Cell = { id: "other", raw: 90, x: 90 }; let active: Cell = cell;
  class Hook { [Symbol.toPrimitive](hint: string): number { log.push(`primitive:${hint}`); cell.raw = 99; active = other; return initial; } }
  if (hooked) Object.assign(view, { value: new Hook() });
  function target(): Cell { log.push(`target:${active.id}`); return active; }
  function run(): number { log.push("run"); return --target().x; }
  log.length = 0; const result = run();
  const expected = ["run", "target:first", "get:first"]; if (hooked) expected.push("primitive:number"); expected.push(`set:first:${initial - 1}`);
  assert.compareArray(log, expected);
  assert.sameValue(result, initial - 1); assert.sameValue(typeof result, "number"); assert.sameValue(cell.raw, -(initial - 1));
  assert.sameValue(other.raw, 90); assert.sameValue(other.x, 90); assert.sameValue(active, hooked ? other : cell);
}
