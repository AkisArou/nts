/*---
description: A method retrieved from a typed Map is bound to a foreign receiver and called after that receiver changes.
features: [ts-dispatch-route-method-values, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-interfaces, ts-function-types, ts-this, ts-this-parameter, ts-map-set]
---*/
// Control: the stored source-class tag selects a plain function with the same explicit receiver.
type MethodKind = "first" | "second" | "third";
interface MethodState { kind: string; amount: number; total: number; }
type MethodCall = (this: MethodState | void, value: number) => number;
interface MethodSource extends MethodState { kind: MethodKind; run: MethodCall; }
const log: unknown[] = [];
class First implements MethodSource {
  kind: MethodKind = "first"; amount: number = 10; total: number = 0;
  run(this: MethodState | void, value: number): number { log.push("First.run", this, value); if (this) this.total += value * 1; return (this ? this.amount : 0) + value * 1; }
}
class Second implements MethodSource {
  padding: string = "wide"; kind: MethodKind = "second"; amount: number = 20; total: number = 0;
  run(this: MethodState | void, value: number): number { log.push("Second.run", this, value); if (this) this.total += value * 2; return (this ? this.amount : 0) + value * 2; }
}
class Third implements MethodSource {
  padding: boolean = true; kind: MethodKind = "third"; amount: number = 30; total: number = 0;
  run(this: MethodState | void, value: number): number { log.push("Third.run", this, value); if (this) this.total += value * 3; return (this ? this.amount : 0) + value * 3; }
}
function firstCall(receiver: MethodState | void, value: number): number { log.push("First.run", receiver, value); if (receiver) receiver.total += value * 1; return (receiver ? receiver.amount : 0) + value * 1; }
function secondCall(receiver: MethodState | void, value: number): number { log.push("Second.run", receiver, value); if (receiver) receiver.total += value * 2; return (receiver ? receiver.amount : 0) + value * 2; }
function thirdCall(receiver: MethodState | void, value: number): number { log.push("Third.run", receiver, value); if (receiver) receiver.total += value * 3; return (receiver ? receiver.amount : 0) + value * 3; }
for (const input of [-2, 0, 3]) {
  const sources: MethodSource[] = [new First(), new Second(), new Third()];
  for (const source of sources) {
    log.length = 0;
    const registry = new Map<string, MethodKind>([["run", source.kind]]);
    const receiver: MethodState = { kind: "foreign", amount: 50, total: 0 }; log.push("saved", source.kind, source);
    const saved = registry.get("run"); if (saved === undefined) throw new Test262Error("missing method");
    source.amount = 1000 + input; receiver.amount = 50 + input; log.push("ready", source, receiver);
    const result = saved === "first" ? firstCall(receiver, input) : saved === "second" ? secondCall(receiver, input) : thirdCall(receiver, input);
    const factor = source.kind === "first" ? 1 : source.kind === "second" ? 2 : 3;
    const label = source.kind === "first" ? "First.run" : source.kind === "second" ? "Second.run" : "Third.run";
    assert.sameValue(result, 50 + input + input * factor);
    assert.sameValue(receiver.total, input * factor);
    assert.compareArray(log, ["saved", source.kind, source, "ready", source, receiver, label, receiver, input]);
    assert.sameValue(source.total, 0); assert.sameValue(source.amount, 1000 + input); assert.sameValue(receiver.amount, 50 + input);
  }
}
