/*---
description: Transplanting a fresh class evaluation prototype changes instance answers through retained typed tuple aliases. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-class-expression, ts-construct-signatures, ts-functions, ts-interfaces, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-unknown, ts-narrowing]
---*/
// Two Same evaluations and a literal cross View aliases; node changes only the selected object to Second, First and null ancestry while a peer stays First. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
interface View { label: string; }
function evaluate(): new () => View { return class Same { label: string = "same"; }; }
const First = evaluate(), Second = evaluate();
function inspect(value: View): boolean[] { return [follows(value, First.prototype), follows(value, Second.prototype), follows(value, Object.prototype)]; }
const rows: [View, boolean[]][] = [[new First(), [true, false, true]], [new Second(), [false, true, true]], [{ label: "same" }, [false, false, true]]];
const changes: [object | null, boolean[]][] = [[Second.prototype, [false, true, true]], [First.prototype, [true, false, true]], [null, [false, false, false]]];
for (const [value, initial] of rows) {
  const aliases: [View, View] = [value, value], peer: View = new First();
  let previous = initial;
  for (const [prototype, expected] of changes) {
    const before = inspect(aliases[0]); assert.compareArray(before, previous);
    const changed = Object.setPrototypeOf(aliases[1], prototype);
    const after = inspect(aliases[0]), untouched = inspect(peer);
    assert.sameValue(changed, value); assert.sameValue(aliases[0], aliases[1]); assert.sameValue(aliases[0].label, "same");
    assert.compareArray(after, expected); assert.compareArray(untouched, [true, false, true]);
    previous = expected;
  }
}
