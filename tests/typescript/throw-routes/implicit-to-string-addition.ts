/*---
description: String addition reaches a throwing interface toString after ordinary valueOf fallback.
features: [ts-throw-route-implicit, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-conversions, ts-to-string]
---*/
// Route: string addition to an interface toString -> caller outer catch; Node preserves the original fault and body/caller/outer finally order.
interface RouteView { toString(): string; }
const log: string[] = [];
let state = 0, expectedOwner: object = {};
class HookBox implements RouteView {
  input: number; fault: RangeError; seen: number = 0;
  constructor(input: number, fault: RangeError) { this.input = input; this.fault = fault; }
  toString(): string { return hookBody(this, arguments.length); }
}
function hookBody(owner: HookBox, argc: number): string {
  assert.sameValue(owner, expectedOwner); state++; owner.seen++;
  log.push(`${owner.input}:${argc}:${state}`);
  try {
    if (owner.input < 0) { log.push(`throw:${state}`); throw owner.fault; }
    log.push(`return:${state}`); return `v:${owner.input}`;
  } finally { state += 10; log.push(`body-finally:${state}`); }
}
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0; const fault = new RangeError(`fault:${n}`);
  const owner = new HookBox(n, fault), view: RouteView = owner; expectedOwner = owner;
  let result: string | undefined; let caught = false;
  try {
    try { log.push("route:0"); result = "[" + view + "]"; log.push(`after:${state}`); }
    finally { state += 100; log.push(`caller-finally:${state}`); }
  } catch (error: unknown) {
    assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, `fault:${n}`); }
    caught = true; log.push(`catch:${state}`);
  } finally { state += 1000; log.push(`outer-finally:${state}`); }
  assert.sameValue(result, n < 0 ? undefined : `[v:${n}]`); assert.sameValue(caught, n < 0);
  assert.sameValue(owner.seen, 1); assert.sameValue(state, 1111);
  const expected = ["route:0", `${n}:0:1`, n < 0 ? "throw:1" : "return:1", "body-finally:11"];
  if (n >= 0) expected.push("after:11");
  expected.push("caller-finally:111"); if (n < 0) expected.push("catch:111");
  expected.push("outer-finally:1111"); assert.compareArray(log, expected);
}
