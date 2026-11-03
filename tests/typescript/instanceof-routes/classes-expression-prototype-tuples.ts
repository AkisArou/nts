/*---
description: Repeated class expression evaluations retain separate instance and prototype identities through tuple elements.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-class-expression, ts-construct-signatures, ts-inheritance, ts-functions, ts-interfaces, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-instanceof]
---*/
// Two Twin evaluations and a descendant cross typed tuples; node finds only the matching evaluation and excludes each constructor prototype itself.
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
  const actual = [value instanceof First, value instanceof Second, value instanceof Descendant];
  assert.compareArray(actual, expected);
}
