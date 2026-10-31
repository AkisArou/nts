/*---
description: Control for json-root-interface; the implicit hook is called explicitly.
features: [ts-implicit-json, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-functions]
---*/
// Control: ../implicit-calls/json-root-interface.ts; only the hook call becomes explicit.
interface Shape { label: string; value: number; seen: number; toJSON(key: string): string; }
const log: string[] = [];
class Left implements Shape {
  label: "left" = "left"; value: number; seen: number = 0;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): string {
    this.seen += 1; log.push(`json:${this.label}:${key}:${this.value}:${this.seen}`);
    return `${this.label}:${this.value + 1}`;
  }
}
class Right implements Shape {
  label: "right" = "right"; value: number; seen: number = 0;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): string {
    this.seen += 2; log.push(`json:${this.label}:${key}:${this.value}:${this.seen}`);
    return `${this.label}:${this.value + 2}`;
  }
}
function run(item: Shape): string | undefined { return JSON.stringify(item.toJSON("")); }
for (const value of [-2, 0, 3]) {
  log.length = 0;
  const label = value < 0 ? "left" : "right"; const unit = label === "left" ? 1 : 2;
  const item = label === "left" ? new Left(value) : new Right(value);
  const result = run(item);
  const encoded = `${label}:${value + unit}`;
  assert.sameValue(result, `"${encoded}"`);
  assert.sameValue(item.value, value);
  assert.sameValue(item.seen, unit);
  assert.compareArray(log, [`json:${label}::${value}:${unit}`]);
}
