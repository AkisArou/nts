/*---
description: "Control for calls-callee-getter-throw; A throwing callee getter prevents all arguments while a returning getter captures its old method before they mutate it."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-this, ts-type-aliases, ts-function-types, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-template-literals, ts-this-parameter]
---*/
// An interface carries a class accessor; node stops at a throwing method getter before argument effects, or captures its returned function and runs both arguments before the body. The control uses ordered temporaries.
const log: string[] = [];
type Method = (this: Source, a: number, b: number) => number;
interface Source { label: string; fail: boolean; value: number; current: Method; readonly method: Method; }
function old(this: Source, a: number, b: number): number { log.push(`old:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; }
function newer(this: Source, a: number, b: number): number { log.push("new"); return -100; }
class Alpha implements Source { label: string = "A"; fail: boolean = false; value: number = 0; current: Method = old; get method(): Method { log.push(`get:${this.label}`); if (this.fail) throw new RangeError("callee"); return this.current; } }
class Beta implements Source { label: string = "B"; fail: boolean = false; value: number = 0; current: Method = old; padding: string = "wide"; get method(): Method { log.push(`get:${this.label}`); if (this.fail) throw new RangeError("callee"); return this.current; } }
function first(source: Source): number { log.push("first"); source.current = newer; source.value = 1; return 2; }
function second(source: Source): number { log.push("second"); source.value = 3; return 4; }
function run(source: Source): number {
  log.push("run");
  const receiver = source;
  const fn = receiver.method;
  const a = first(source);
  const b = second(source);
  return fn.call(receiver, a, b);
}
const sources: Source[] = [new Alpha(), new Beta()];
for (const source of sources) for (const fail of [false, true]) {
  source.fail = fail; source.value = 0; source.current = old; log.length = 0; let result: number | undefined, caught: unknown; try { result = run(source); } catch (error: unknown) { caught = error; log.push("catch"); }
  const expected = ["run", `get:${source.label}`]; if (fail) expected.push("catch"); else expected.push("first", "second", `old:${source.label}:3:2:4`);
  assert.compareArray(log, expected);
  assert.sameValue(source.value, fail ? 0 : 3); assert.sameValue(source.current, fail ? old : newer);
  if (fail) { assert.sameValue(result, undefined); assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) { assert.sameValue(caught.constructor, RangeError); assert.sameValue(caught.message, "callee"); } }
  else { assert.sameValue(result, 324); assert.sameValue(caught, undefined); }
}
