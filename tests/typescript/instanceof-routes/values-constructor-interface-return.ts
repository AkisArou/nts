/*---
description: An interface method returns the constructor used by the instance check at that call.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures, ts-interfaces, ts-instanceof]
---*/
// A Resolver returns RouteFirst or RouteSecond as RouteCtor; node tests that returned value through alternating selections.
type RouteCtor = (abstract new () => object) & { readonly prototype: object };
class RouteFirst { label: string = "same"; }
class RouteChild extends RouteFirst {}
class RouteSecond { label: string = "same"; }
const handmade: unknown = Object.create(RouteFirst.prototype);
const rows: [unknown, boolean, boolean][] = [[new RouteFirst(), true, false], [new RouteChild(), true, false], [new RouteSecond(), false, true], [handmade, true, false], [RouteFirst.prototype, false, false], [{ label: "same" }, false, false], [null, false, false], [1, false, false], [() => 1, false, false]];
interface Resolver { choose(first: boolean): RouteCtor; }
const resolver: Resolver = { choose(first: boolean): RouteCtor { return first ? RouteFirst : RouteSecond; } };
for (const selected of [false, true, false, true]) for (const [value, first, second] of rows) {
  const target: RouteCtor = resolver.choose(selected);
  const answer = value instanceof target;
  assert.sameValue(answer, selected ? first : second);
}
