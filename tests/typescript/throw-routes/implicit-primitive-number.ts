/*---
description: The number hint reaches a throwing interface Symbol.toPrimitive.
features: [ts-throw-route-implicit, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-conversions, ts-to-primitive, ts-symbols]
---*/
// Route: number-hint Symbol.toPrimitive through an interface -> caller outer catch; Node preserves the original fault and body/caller/outer finally order.
interface RouteView { [Symbol.toPrimitive](hint: "default" | "number" | "string"): number | string; }
const log: string[] = [];
let state = 0, expectedOwner: object = {};
class HookBox implements RouteView {
  input: number; fault: RangeError; seen: number = 0;
  constructor(input: number, fault: RangeError) { this.input = input; this.fault = fault; }
  [Symbol.toPrimitive](hint: "default" | "number" | "string"): number | string { return hookBody(this, hint, arguments.length); }
}
function hookBody(owner: HookBox, hint: "default" | "number" | "string", argc: number): number | string {
  assert.sameValue(owner, expectedOwner); state++; owner.seen++;
  log.push(`${hint}:${owner.input}:${argc}:${state}`);
  try {
    if (owner.input < 0) { log.push(`throw:${state}`); throw owner.fault; }
    log.push(`return:${state}`); return hint === "string" ? `v:${owner.input}` : owner.input * 2;
  } finally { state += 10; log.push(`body-finally:${state}`); }
}
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0; const fault = new RangeError(`fault:${n}`);
  const owner = new HookBox(n, fault), view: RouteView = owner; expectedOwner = owner;
  let result: number | undefined; let caught = false;
  try {
    try { log.push("route:0"); result = +view; log.push(`after:${state}`); }
    finally { state += 100; log.push(`caller-finally:${state}`); }
  } catch (error: unknown) {
    assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, `fault:${n}`); }
    caught = true; log.push(`catch:${state}`);
  } finally { state += 1000; log.push(`outer-finally:${state}`); }
  assert.sameValue(result, n < 0 ? undefined : n * 2); assert.sameValue(caught, n < 0);
  assert.sameValue(owner.seen, 1); assert.sameValue(state, 1111);
  const expected = ["route:0", `number:${n}:1:1`, n < 0 ? "throw:1" : "return:1", "body-finally:11"];
  if (n >= 0) expected.push("after:11");
  expected.push("caller-finally:111"); if (n < 0) expected.push("catch:111");
  expected.push("outer-finally:1111"); assert.compareArray(log, expected);
}
