/*---
description: A constructor read from a Map uses the latest stored target and rejects a missing key explicitly. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures, ts-map-set]
---*/
// RouteCtor values cross a string-keyed Map reader; node changes answers after replacement and preserves each operand identity. The control makes the specified walk or error explicit.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
type RouteCtor = (abstract new () => object) & { readonly prototype: object };
class RouteFirst { label: string = "same"; }
class RouteChild extends RouteFirst {}
class RouteSecond { label: string = "same"; }
const handmade: unknown = Object.create(RouteFirst.prototype);
const rows: [unknown, boolean, boolean][] = [[new RouteFirst(), true, false], [new RouteChild(), true, false], [new RouteSecond(), false, true], [handmade, true, false], [RouteFirst.prototype, false, false], [{ label: "same" }, false, false], [null, false, false], [1, false, false], [() => 1, false, false]];
const constructors = new Map<string, RouteCtor>([["active", RouteFirst]]);
function accepts(value: unknown, key: string): boolean {
  const target = constructors.get(key);
  if (target === undefined) throw new TypeError();
  return follows(value, target.prototype);
}
const targets: [RouteCtor, number][] = [[RouteSecond, 2], [RouteFirst, 1], [RouteSecond, 2]];
for (const [target, column] of targets) {
  constructors.set("active", target);
  for (const [value, first, second] of rows) {
    const answer = accepts(value, "active");
    assert.sameValue(answer, column === 1 ? first : second);
    assert.throws(TypeError, () => accepts(value, "missing"));
  }
}
