/*---
description: Constructor-array aliases retain replacement while a copied constructor retains its original identity.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures, ts-instanceof]
---*/
// RouteCtor array slots are replaced through an alias; node uses the live slot and the separately retained constructor independently.
type RouteCtor = (abstract new () => object) & { readonly prototype: object };
class RouteFirst { label: string = "same"; }
class RouteChild extends RouteFirst {}
class RouteSecond { label: string = "same"; }
const handmade: unknown = Object.create(RouteFirst.prototype);
const rows: [unknown, boolean, boolean][] = [[new RouteFirst(), true, false], [new RouteChild(), true, false], [new RouteSecond(), false, true], [handmade, true, false], [RouteFirst.prototype, false, false], [{ label: "same" }, false, false], [null, false, false], [1, false, false], [() => 1, false, false]];
const constructors: RouteCtor[] = [RouteFirst, RouteSecond];
const alias: RouteCtor[] = constructors;
const retained: RouteCtor = constructors[0];
const targets: [RouteCtor, number][] = [[RouteSecond, 2], [RouteFirst, 1], [RouteSecond, 2]];
for (const [target, column] of targets) {
  alias[0] = target;
  for (const [value, first, second] of rows) {
    const live = value instanceof constructors[0], original = value instanceof retained;
    assert.sameValue(live, column === 1 ? first : second); assert.sameValue(original, first);
  }
}
