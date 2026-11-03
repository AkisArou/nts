/*---
description: A construct-signature parameter classifies the actual chain for each routed constructor. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures]
---*/
// RouteFirst, RouteChild, RouteSecond and impostors cross a RouteCtor parameter; node answers from each supplied constructor prototype. The control makes the specified walk or error explicit.
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
function accepts(value: unknown, target: RouteCtor): boolean { return follows(value, target.prototype); }
const targets: [RouteCtor, number][] = [[RouteSecond, 2], [RouteFirst, 1], [RouteSecond, 2]];
for (const [target, column] of targets) for (const [value, first, second] of rows) {
  const answer = accepts(value, target);
  assert.sameValue(answer, column === 1 ? first : second);
}
