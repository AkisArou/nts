/*---
description: Promise.resolve reaches a class then method through a interface view; node queues the hook and preserves resolve, reject and later effects.
features: [ts-implicit-thenable, ts-async, ts-class, ts-class-fields, ts-interfaces, ts-functions, ts-errors, ts-unknown, ts-function-types]
flags: [async]
---*/
// Route: Promise.resolve reaches a class then method through a interface view; node queues the hook and preserves resolve, reject and later effects.
interface Shape { label: string; value: number; state: number; then(resolve: (value: number) => void, reject: (error: RangeError) => void): void; }
const log: string[] = [];
class Left implements Shape {
  label: "left" = "left"; value: number; state: number = 0;
  constructor(value: number) { this.value = value; }
  then(resolve: (value: number) => void, reject: (error: RangeError) => void): void {
    this.state += 1; log.push(`then:${this.label}:${this.value}:${typeof resolve}:${typeof reject}:${this.state}`);
    if (this.value < 0) reject(new RangeError(`${this.label}:${this.value}`)); else resolve(this.value + 1);
    this.state += 10; log.push(`after:${this.label}:${this.state}`);
  }
}
class Right implements Shape {
  label: "right" = "right"; value: number; state: number = 0;
  constructor(value: number) { this.value = value; }
  then(resolve: (value: number) => void, reject: (error: RangeError) => void): void {
    this.state += 2; log.push(`then:${this.label}:${this.value}:${typeof resolve}:${typeof reject}:${this.state}`);
    if (this.value < 0) reject(new RangeError(`${this.label}:${this.value}`)); else resolve(this.value + 2);
    this.state += 20; log.push(`after:${this.label}:${this.state}`);
  }
}
function run(item: Shape): Promise<number> { return Promise.resolve(item); }
async function main(): Promise<void> {
  for (const value of [-2, 0, 3]) {
    log.length = 0;
    const label = value < 0 ? "left" : "right"; const unit = label === "left" ? 1 : 2;
    const item = label === "left" ? new Left(value) : new Right(value);
    let result: number | undefined; let caught = false;
    const pending = run(item); log.push(`pending:${item.state}`);
    try { result = await pending; log.push(`resolved:${result}:${item.state}`); }
    catch (error: unknown) {
      assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) assert.sameValue(error.message, `${label}:${value}`);
      caught = true; log.push(`caught:${item.state}`);
    } finally { log.push(`finally:${item.state}`); item.state += 100; }
    assert.sameValue(result, value < 0 ? undefined : value + unit); assert.sameValue(caught, value < 0);
    assert.sameValue(item.value, value); assert.sameValue(item.state, unit * 11 + 100);
    const settled = value < 0 ? `caught:${unit * 11}` : `resolved:${value + unit}:${unit * 11}`;
    assert.compareArray(log, ["pending:0", `then:${label}:${value}:function:function:${unit}`, `after:${label}:${unit * 11}`, settled, `finally:${unit * 11}`]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
