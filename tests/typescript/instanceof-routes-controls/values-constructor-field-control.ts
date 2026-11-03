/*---
description: Replacing a constructor field changes every later instance test through its reader. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures]
---*/
// RouteCtor values replace a Selector field; node follows the current field after each write while the operands stay identical. The control makes the specified walk or error explicit.
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
class Selector {
  target: RouteCtor = RouteFirst;
  accepts(value: unknown): boolean { return follows(value, this.target.prototype); }
}
const selector = new Selector();
const targets: [RouteCtor, number][] = [[RouteFirst, 1], [RouteSecond, 2], [RouteFirst, 1]];
for (const [target, column] of targets) {
  selector.target = target;
  for (const [value, first, second] of rows) {
    const answer = selector.accepts(value);
    assert.sameValue(answer, column === 1 ? first : second);
  }
}
