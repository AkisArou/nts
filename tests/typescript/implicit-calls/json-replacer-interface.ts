/*---
description: JSON.stringify reaches toJSON through a interface view at the replacer; node preserves its key, state and result.
features: [ts-implicit-json, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-functions, ts-objects, ts-unknown]
---*/
// Route: JSON.stringify reaches toJSON through a interface view at the replacer; node preserves its key, state and result.
interface Shape { label: string; value: number; seen: number; toJSON(key: string): { payload: string }; }
const log: string[] = [];
let changes = 0;
class Left implements Shape {
  label: "left" = "left"; value: number; seen: number = 0;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): { payload: string } {
    this.seen += 1; changes += 1; log.push(`json:${this.label}:${key}:${this.value}:${this.seen}`);
    return { payload: `${this.label}:${this.value + 1}` };
  }
}
class Right implements Shape {
  label: "right" = "right"; value: number; seen: number = 0;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): { payload: string } {
    this.seen += 2; changes += 2; log.push(`json:${this.label}:${key}:${this.value}:${this.seen}`);
    return { payload: `${this.label}:${this.value + 2}` };
  }
}
function replacer(key: string, value: unknown): unknown {
  changes += 10; log.push(`replace:${key}:${typeof value === "string" ? value : typeof value}:${changes}`);
  return typeof value === "string" ? value + "!" : value;
}
function run(item: Shape): string | undefined { return JSON.stringify(item, replacer); }
for (const value of [-2, 0, 3]) {
  log.length = 0; changes = 0;
  const label = value < 0 ? "left" : "right"; const unit = label === "left" ? 1 : 2;
  const item = label === "left" ? new Left(value) : new Right(value);
  const result = run(item);
  const encoded = `${label}:${value + unit}`;
  assert.sameValue(result, `{"payload":"${encoded}!"}`);
  assert.sameValue(item.value, value);
  assert.sameValue(item.seen, unit);
  assert.sameValue(changes, unit + 20);
  assert.compareArray(log, [`json:${label}::${value}:${unit}`, `replace::object:${unit + 10}`, `replace:payload:${encoded}:${unit + 20}`]);
}
