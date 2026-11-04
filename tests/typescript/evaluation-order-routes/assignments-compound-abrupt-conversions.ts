/*---
description: "Compound assignment retains exact partial effects across RHS, left conversion, right conversion and setter failures."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-objects, ts-accessors, ts-this, ts-closures, ts-unsound-object-assign, ts-conversions, ts-to-primitive, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-instanceof, ts-typeof-operator]
---*/
// An interface accessor with ordinary Object.assign-widened numbers carries +=; node evaluates RHS before left/right conversions and stops exactly at each throwing stage.
const log: string[] = [];
interface Cell { raw: number; x: number; }
for (const phase of ["ok", "rhs", "left", "right", "set"]) for (const initial of [-2, 0, 8]) {
  const failure = phase === "rhs" ? new RangeError("rhs") : phase === "left" ? new SyntaxError("left") : phase === "right" ? new TypeError("right") : new URIError("set");
  const data = { value: initial }, leftView = { value: initial }, rightView = { value: 3 };
  const cell: Cell = { raw: 0, get x(): number { log.push("get"); return leftView.value; }, set x(value: number) { log.push(`set:${value}`); if (phase === "set") throw failure; this.raw = value * 2; } };
  class Left { valueOf(): number { log.push(`left:${data.value}`); cell.raw = 88; if (phase === "left") throw failure; return data.value; } }
  class Right { valueOf(): number { log.push("right"); cell.raw = 77; if (phase === "right") throw failure; return 3; } }
  Object.assign(leftView, { value: new Left() }); Object.assign(rightView, { value: new Right() });
  function target(): Cell { log.push("target"); return cell; }
  function rhs(): number { log.push("rhs"); cell.raw = 99; data.value = initial + 10; if (phase === "rhs") throw failure; return rightView.value; }
  function run(): number { log.push("run"); return target().x += rhs(); }
  log.length = 0; let result: number | undefined; let caught: unknown; try { result = run(); } catch (error) { log.push("caught"); caught = error; }
  const expected = ["run", "target", "get", "rhs"];
  if (phase !== "rhs") expected.push(`left:${initial + 10}`); if (phase !== "rhs" && phase !== "left") expected.push("right");
  if (phase === "ok" || phase === "set") expected.push(`set:${initial + 13}`); if (phase !== "ok") expected.push("caught");
  assert.compareArray(log, expected);
  assert.sameValue(caught, phase === "ok" ? undefined : failure); assert.sameValue(caught instanceof RangeError, phase === "rhs"); assert.sameValue(caught instanceof SyntaxError, phase === "left");
  assert.sameValue(caught instanceof TypeError, phase === "right"); assert.sameValue(caught instanceof URIError, phase === "set");
  assert.sameValue(result, phase === "ok" ? initial + 13 : undefined); assert.sameValue(typeof result, phase === "ok" ? "number" : "undefined");
  assert.sameValue(cell.raw, phase === "rhs" ? 99 : phase === "left" ? 88 : phase === "ok" ? (initial + 13) * 2 : 77); assert.sameValue(data.value, initial + 10);
}
