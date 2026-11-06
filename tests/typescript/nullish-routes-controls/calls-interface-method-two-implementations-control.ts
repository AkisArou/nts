/*---
description: "An interface optional method is called only by the implementation that supplies it. Route: two interface implementations (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An interface optional method is called only by the implementation that supplies it. Route: two interface implementations. Node prints calls-interface-method-two-implementations:ok.
interface Service { id: number; run?(this: Service): number }
class HasRun implements Service { id = 31; run(): number { return this.id; } }
class NoRun implements Service { id = 32; }
function read(service: Service): number | undefined {
  const fn = service.run; const result = fn === null || fn === undefined ? undefined : fn.call(service);
  return result;
}
assert.sameValue(read(new HasRun()), 31);
assert.sameValue(read(new NoRun()), undefined);
console.log("calls-interface-method-two-implementations:ok");
