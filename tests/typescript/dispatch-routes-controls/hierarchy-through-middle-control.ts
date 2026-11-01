/*---
description: Control for hierarchy-through-middle; stored class tags choose direct plain function calls.
features: [ts-dispatch-route-hierarchies, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-this, ts-functions, ts-arrays]
---*/
// The same receivers retain their classes; tags select plain functions and lexical super calls name each level explicitly.
const log: unknown[] = [];
class DispatchRoot {
  kind: string = "root"; state: number = 0;
  m(value: number): number { log.push("Root.m", this, value, this.state); this.state += value; log.push("write", this, this.state); return this.state + 1; }
}
class DispatchMiddle extends DispatchRoot {
  override kind: string = "middle"; middle: number = 10;
  override m(value: number): number { log.push("Middle.m", this, value, this.state); this.state += value * 10; log.push("write", this, this.state); return this.state + 10; }
}
class DispatchGap extends DispatchMiddle { override kind: string = "gap"; gap: string = "gap"; }
class DispatchLeaf extends DispatchGap {
  override kind: string = "leaf"; leaf: boolean = true;
  override m(value: number): number { log.push("Leaf.m", this, value, this.state); this.state += value * 100; log.push("write", this, this.state); return this.state + 100; }
}
class DispatchTail extends DispatchLeaf { override kind: string = "tail"; tail: number[] = []; }
class DispatchOther extends DispatchLeaf {
  override kind: string = "other"; other: string = "other";
  override m(value: number): number { log.push("Other.m", this, value, this.state); this.state += value * 1000; log.push("write", this, this.state); return this.state + 1000; }
}
function rootM(receiver: DispatchRoot, value: number): number { log.push("Root.m", receiver, value, receiver.state); receiver.state += value; log.push("write", receiver, receiver.state); return receiver.state + 1; }
function middleM(receiver: DispatchRoot, value: number): number { log.push("Middle.m", receiver, value, receiver.state); receiver.state += value * 10; log.push("write", receiver, receiver.state); return receiver.state + 10; }
function leafM(receiver: DispatchRoot, value: number): number { log.push("Leaf.m", receiver, value, receiver.state); receiver.state += value * 100; log.push("write", receiver, receiver.state); return receiver.state + 100; }
function otherM(receiver: DispatchRoot, value: number): number { log.push("Other.m", receiver, value, receiver.state); receiver.state += value * 1000; log.push("write", receiver, receiver.state); return receiver.state + 1000; }
function invoke(receiver: DispatchMiddle, value: number): number {
  if (receiver.kind === "root") return rootM(receiver, value);
  if (receiver.kind === "middle" || receiver.kind === "gap") return middleM(receiver, value);
  return receiver.kind === "other" ? otherM(receiver, value) : leafM(receiver, value);
}
for (const input of [-3, 0, 4]) {
  const rows = [
    { receiver: new DispatchMiddle(), kind: "middle", method: "Middle.m", weight: 10 },
    { receiver: new DispatchGap(), kind: "gap", method: "Middle.m", weight: 10 },
    { receiver: new DispatchLeaf(), kind: "leaf", method: "Leaf.m", weight: 100 },
  ];
  for (const row of rows) {
    log.length = 0; const result = invoke(row.receiver, input); const state = input * row.weight;
    assert.sameValue(row.receiver.kind, row.kind); assert.sameValue(result, state + row.weight); assert.sameValue(row.receiver.state, state);
    assert.compareArray(log, [row.method, row.receiver, input, 0, "write", row.receiver, state]);
  }
}
