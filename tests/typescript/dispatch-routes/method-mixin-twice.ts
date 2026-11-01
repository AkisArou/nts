/*---
description: A typed constructor mixin applied twice preserves both super levels and the implementation of each supplied base class.
features: [ts-dispatch-route-method-values, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-interfaces, ts-function-types, ts-mixins, ts-class-expression, ts-inheritance, ts-override, ts-this]
---*/
// Route: MixinShape holds two layers over First, Second or Third; node enters outer, inner and the supplied base with the same receiver.
interface MixinShape { kind: string; amount: number; total: number; run(value: number): number; }
type MixinConstructor = new () => MixinShape;
const log: unknown[] = [];
class First implements MixinShape { kind: string = "first"; amount: number = 10; total: number = 0; run(value: number): number { log.push("First.run", this, value); this.total += value * 1; return this.amount + value * 1; } }
class Second implements MixinShape { kind: string = "second"; amount: number = 20; total: number = 0; run(value: number): number { log.push("Second.run", this, value); this.total += value * 2; return this.amount + value * 2; } }
class Third implements MixinShape { kind: string = "third"; amount: number = 30; total: number = 0; run(value: number): number { log.push("Third.run", this, value); this.total += value * 3; return this.amount + value * 3; } }
function Layer(Base: MixinConstructor, label: string): MixinConstructor {
  return class extends Base {
    override run(value: number): number { log.push(label, this, value); return super.run(value + 10) * 2; }
  };
}
const TwiceFirst = Layer(Layer(First, "inner"), "outer");
const TwiceSecond = Layer(Layer(Second, "inner"), "outer");
const TwiceThird = Layer(Layer(Third, "inner"), "outer");
for (const input of [-2, 0, 3]) {
  const sources: MixinShape[] = [new TwiceFirst(), new TwiceSecond(), new TwiceThird()];
  for (const source of sources) {
    log.length = 0; source.amount = 50 + input;
    const result = source.run(input);
    const factor = source.kind === "first" ? 1 : source.kind === "second" ? 2 : 3;
    const label = source.kind === "first" ? "First.run" : source.kind === "second" ? "Second.run" : "Third.run";
    assert.sameValue(result, (50 + input + (input + 20) * factor) * 4);
    assert.compareArray(log, ["outer", source, input, "inner", source, input + 10, label, source, input + 20]);
    assert.sameValue(source.total, (input + 20) * factor); assert.sameValue(source.amount, 50 + input);
  }
}
