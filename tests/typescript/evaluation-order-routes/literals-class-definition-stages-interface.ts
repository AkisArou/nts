/*---
description: "Class heritage and all computed names precede ordered static initialization."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-computed-keys, ts-static, ts-class-static-block, ts-inheritance, ts-typeof-type, ts-instanceof]
---*/
// An interface supplies class-definition hooks; node evaluates extends, both method keys, then static fields and the intervening block.
const log: string[] = [];
class Base { marker: number = 1; }
interface Route { choose(): typeof Base; key(label: string): string; value(label: string): number; }
let current = 0;
for (const input of [2, 9]) {
  log.length = 0; current = input;
  const route: Route = { choose(): typeof Base { log.push("extends"); current++; return Base; }, key(label: string): string { log.push("key:" + label); const key = label + current; current += 10; return key; }, value(label: string): number { log.push("value:" + label); const value = current; current += 100; return value; } };
  class Child extends route.choose() {
    [route.key("instance")](): number { log.push("method:instance"); return 1; }
    static first: number = route.value("first");
    static [route.key("static")](): number { log.push("method:static"); return 2; }
    static { log.push("block"); current += 1000; }
    static last: number = route.value("last");
  }
  const instance = new Child();
  assert.compareArray(log, ["extends", "key:instance", "key:static", "value:first", "block", "value:last"]);
  assert.sameValue(Child.first, input + 21); assert.sameValue(Child.last, input + 1121); assert.sameValue(current, input + 1221);
  assert.sameValue(("instance" + (input + 1)) in instance, true); assert.sameValue(("static" + (input + 11)) in Child, true); assert.sameValue(instance instanceof Base, true);
  assert.compareArray(Object.keys(Child), ["first", "last"]); assert.sameValue(instance.marker, 1);
}
