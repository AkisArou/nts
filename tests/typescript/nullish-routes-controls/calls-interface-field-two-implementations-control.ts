/*---
description: "An interface optional function field is called only when present. Route: two class implementations of optional callback field (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An interface optional function field is called only when present. Route: two class implementations of optional callback field. Node prints calls-interface-field-two-implementations:ok.
interface Service { transform?: (n: number) => number }
class HasField implements Service { transform = (n: number): number => n + 2; }
class NoField implements Service { transform?: (n: number) => number; }
function read(service: Service): number | undefined {
  const fn = service.transform; const result = fn === null || fn === undefined ? undefined : fn.call(service, 4);
  return result;
}
assert.sameValue(read(new HasField()), 6);
assert.sameValue(read(new NoField()), undefined);
console.log("calls-interface-field-two-implementations:ok");
