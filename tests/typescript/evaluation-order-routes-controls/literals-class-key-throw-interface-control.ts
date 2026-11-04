/*---
description: "A throwing computed class name prevents every static initializer and later name. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-expression, ts-class-fields, ts-static, ts-computed-keys, ts-inheritance, ts-interfaces, ts-objects, ts-typeof-type, ts-errors]
---*/
// An interface route supplies class hooks; node retains earlier name effects but leaves the destination constructor unchanged if a later name throws. The control names each ordered part.
const log: string[] = [];
class Base { marker: number = 5; }
interface Route { choose(): typeof Base; key(label: string): string; value(): number; }
let current = 0;
for (const failure of [false, true]) for (const input of [1, 7]) {
  log.length = 0; current = input; let output: typeof Base = Base;
  const route: Route = { choose(): typeof Base { log.push("extends"); current++; return Base; }, key(label: string): string { log.push("key:" + label); current += 10; if (failure && label === "second") throw new RangeError("key"); return label; }, value(): number { log.push("field"); current += 100; return current; } };
  function run(): void {
    log.push("run");
    const Parent = route.choose();
    const firstKey = route.key("first");
    const secondKey = route.key("second");
    const lastKey = route.key("last");
    const Built = class extends Parent {
      [firstKey](): number { log.push("method:first"); return 1; }
      static value: number;
      [secondKey](): number { log.push("method:second"); return 2; }
      [lastKey](): number { log.push("method:last"); return 3; }
    };
    const fieldPart = route.value();
    Built.value = fieldPart;
    log.push("block"); current += 1000;
    output = Built;
  }
  if (failure) assert.throws(RangeError, run); else run();
  assert.compareArray(log, failure ? ["run", "extends", "key:first", "key:second"] : ["run", "extends", "key:first", "key:second", "key:last", "field", "block"]);
  assert.sameValue(current, input + (failure ? 21 : 1131)); assert.sameValue(output === Base, failure); assert.sameValue("first" in new output(), !failure);
}
