/*---
description: Control for hierarchy-super-through-gap; stored class tags choose direct plain function calls.
features: [ts-dispatch-route-hierarchies, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-this, ts-functions, ts-arrays]
---*/
// The same receivers retain their classes; tags select plain functions and lexical super calls name each level explicitly.
const log: unknown[] = [];
class DispatchRoot {
  kind: string = "root"; state: number = 0;
  m(value: number): number { log.push("Root.m", this, value); this.state += value; log.push("write", this, this.state); return value + 1; }
}
class DispatchMiddle extends DispatchRoot {
  override kind: string = "middle";
  override m(value: number): number { log.push("Middle.m", this, value); return super.m(value + 10) + 100; }
}
class DispatchGap extends DispatchMiddle { override kind: string = "gap"; gap: string = "gap"; }
class DispatchLeaf extends DispatchGap {
  override kind: string = "leaf";
  override m(value: number): number { log.push("Leaf.m", this, value); return super.m(value * 2) + 1000; }
}
function rootM(receiver: DispatchRoot, value: number): number { log.push("Root.m", receiver, value); receiver.state += value; log.push("write", receiver, receiver.state); return value + 1; }
function middleM(receiver: DispatchRoot, value: number): number { log.push("Middle.m", receiver, value); return rootM(receiver, value + 10) + 100; }
function leafM(receiver: DispatchRoot, value: number): number { log.push("Leaf.m", receiver, value); return middleM(receiver, value * 2) + 1000; }
function invoke(receiver: DispatchRoot, value: number): number {
  if (receiver.kind === "middle" || receiver.kind === "gap") return middleM(receiver, value);
  return leafM(receiver, value);
}
for (const input of [-3, 0, 4]) {
  const rows = [{ receiver: new DispatchMiddle(), kind: "middle", leaf: false },
    { receiver: new DispatchGap(), kind: "gap", leaf: false }, { receiver: new DispatchLeaf(), kind: "leaf", leaf: true }];
  for (const row of rows) {
    log.length = 0; const passed = row.leaf ? input * 2 : input; const result = invoke(row.receiver, input);
    const expected: unknown[] = row.leaf ? ["Leaf.m", row.receiver, input] : [];
    expected.push("Middle.m", row.receiver, passed, "Root.m", row.receiver, passed + 10, "write", row.receiver, passed + 10);
    assert.sameValue(result, passed + (row.leaf ? 1111 : 111)); assert.sameValue(row.receiver.state, passed + 10);
    assert.sameValue(row.receiver.kind, row.kind); assert.compareArray(log, expected);
  }
}
