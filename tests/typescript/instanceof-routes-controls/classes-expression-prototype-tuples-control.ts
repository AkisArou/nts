/*---
description: Repeated class expression evaluations retain separate instance and prototype identities through tuple elements. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-class-expression, ts-construct-signatures, ts-inheritance, ts-functions, ts-interfaces, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-unknown, ts-narrowing, ts-object-type]
---*/
// Two Twin evaluations and a descendant cross typed tuples; node finds only the matching evaluation and excludes each constructor prototype itself. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
interface Stamp { label: string; }
function evaluate(): new () => Stamp { return class Twin { label: string = "same"; }; }
const First = evaluate(), Second = evaluate();
class Descendant extends First {}
const separate = First !== Second, separatePrototypes = First.prototype !== Second.prototype;
assert.sameValue(separate, true); assert.sameValue(separatePrototypes, true);
const rows: [Stamp, boolean[]][] = [
  [new Second(), [false, true, false]], [new First(), [true, false, false]],
  [new Descendant(), [true, false, true]], [First.prototype, [false, false, false]],
  [Second.prototype, [false, false, false]], [Descendant.prototype, [true, false, false]],
  [{ label: "same" }, [false, false, false]],
];
for (const [value, expected] of rows) {
  const actual = [follows(value, First.prototype), follows(value, Second.prototype), follows(value, Descendant.prototype)];
  assert.compareArray(actual, expected);
}
