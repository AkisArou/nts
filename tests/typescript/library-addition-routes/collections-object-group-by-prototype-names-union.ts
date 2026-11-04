/*---
description: "Object grouping safely stores prototype-name collisions after narrowing a union route."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-unions, ts-null-undefined, ts-function-types, ts-spread, ts-errors, ts-type-aliases, ts-narrowing, ts-discriminated-unions, ts-readonly, ts-mapped-types, ts-utility-types]
---*/
// Object.groupBy reaches its items through a discriminated union; node returns no inherited prototype names, even for empty input, and stores collision names as ordinary groups.
const log: string[] = [];
type Route = { kind: "items"; values: readonly string[] } | { kind: "missing"; values: undefined };
function choose(value: string, index: number): string { log.push("callback:" + index + ":" + value); return value; }
function apply(route: Route): Partial<Record<PropertyKey, string[]>> { log.push("apply"); if (route.kind !== "items") throw new Test262Error("missing route"); const items = route.values, callback = choose;
  return Object.groupBy(items, callback);
}
const names = ["__proto__", "constructor", "toString", "hasOwnProperty", "__proto__"];
for (const items of [[], names]) {
  const route: Route = { kind: "items", values: items }, original = [...items];
  log.length = 0; const result = apply(route);
  const expected = items.length === 0 ? ["apply"] : ["apply", "callback:0:__proto__", "callback:1:constructor", "callback:2:toString", "callback:3:hasOwnProperty", "callback:4:__proto__"];
  assert.compareArray(log, expected); assert.compareArray(Object.keys(result), items.length === 0 ? [] : names.slice(0, 4));
  assert.sameValue("valueOf" in result, false); assert.sameValue("isPrototypeOf" in result, false);
  for (const name of names.slice(0, 4)) {
    const group = result[name];
    if (items.length === 0) { assert.sameValue(name in result, false); assert.sameValue(group, undefined); }
    else { if (group === undefined) throw new Test262Error("missing group"); assert.sameValue(name in result, true); assert.compareArray(group, name === "__proto__" ? [name, name] : [name]); assert.sameValue(group === items, false); }
  }
  assert.compareArray(items, original);
}
