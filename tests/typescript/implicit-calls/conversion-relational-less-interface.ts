/*---
description: Relational less preserves left-to-right valueOf calls through a declared Hook interface.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive]
---*/
// Route: < through a declared Hook interface; node preserves every hook call, its effect and the result.
interface Hook { valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  label: string;
  value: number;
  constructor(label: string, value: number) { this.label = label; this.value = value; }
  valueOf(): number {
    state += this.value + 7; log.push(`valueOf:${this.label}:${this.value}:${state}`);
    return this.value;
  }
}
function compare(left: Hook, right: Hook): boolean { return left < right; }
for (const n of [-2, -1, 0, 1, 3]) {
  state = 10; log.length = 0;
  const left: Hook = new Box("left", n);
  const right: Hook = new Box("right", 1);
  const result = compare(left, right);
  assert.sameValue(result, n < 1);
  assert.sameValue(state, n + 25);
  assert.compareArray(log, [`valueOf:left:${n}:${n + 17}`, `valueOf:right:1:${n + 25}`]);
}
