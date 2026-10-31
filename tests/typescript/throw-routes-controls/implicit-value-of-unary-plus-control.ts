/*---
description: Control for implicit-value-of-unary-plus; the same throwing body is called directly in the caller try.
features: [ts-throw-route-implicit, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-conversions, ts-to-primitive]
---*/
// Control: ../throw-routes/implicit-value-of-unary-plus.ts; replace the implicit route with direct named-body calls.
interface RouteView { valueOf(): number; }
const log: string[] = [];
let state = 0, expectedOwner: object = {};
class HookBox implements RouteView {
  input: number; fault: RangeError; seen: number = 0;
  constructor(input: number, fault: RangeError) { this.input = input; this.fault = fault; }
  valueOf(): number { return hookBody(this, arguments.length); }
}
function hookBody(owner: HookBox, argc: number): number {
  assert.sameValue(owner, expectedOwner); state++; owner.seen++;
  log.push(`${owner.input}:${argc}:${state}`);
  try {
    if (owner.input < 0) { log.push(`throw:${state}`); throw owner.fault; }
    log.push(`return:${state}`); return owner.input * 2;
  } finally { state += 10; log.push(`body-finally:${state}`); }
}
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0; const fault = new RangeError(`fault:${n}`);
  const owner = new HookBox(n, fault), view: RouteView = owner; expectedOwner = owner;
  let result: number | undefined; let caught = false;
  try {
    try { log.push("route:0"); result = hookBody(owner, 0); log.push(`after:${state}`); }
    finally { state += 100; log.push(`caller-finally:${state}`); }
  } catch (error: unknown) {
    assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, `fault:${n}`); }
    caught = true; log.push(`catch:${state}`);
  } finally { state += 1000; log.push(`outer-finally:${state}`); }
  assert.sameValue(result, n < 0 ? undefined : n * 2); assert.sameValue(caught, n < 0);
  assert.sameValue(owner.seen, 1); assert.sameValue(state, 1111);
  const expected = ["route:0", `${n}:0:1`, n < 0 ? "throw:1" : "return:1", "body-finally:11"];
  if (n >= 0) expected.push("after:11");
  expected.push("caller-finally:111"); if (n < 0) expected.push("catch:111");
  expected.push("outer-finally:1111"); assert.compareArray(log, expected);
}
