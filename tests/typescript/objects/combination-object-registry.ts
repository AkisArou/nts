/*---
description: A Record of handlers keyed by a literal union, built with computed keys and spread, called through optional chaining.
features: [ts-objects, ts-record, ts-literal-types, ts-computed-keys, ts-spread, ts-optional-chaining, ts-function-types]
---*/
type AppEvent = "open" | "close" | "save";
type Handlers = Partial<Record<AppEvent, (count: number) => string>>;
const prefix = "on";
const base: Handlers = { open: (n) => `${prefix}-open ${n}` };
const closing: AppEvent = "close";
const handlers: Handlers = { ...base, [closing]: (n: number) => `closed ${n}` };
function fire(event: AppEvent, count: number): string {
  return handlers[event]?.(count) ?? `no ${event}`;
}
assert.sameValue(fire("open", 1), "on-open 1");
assert.sameValue(fire("close", 2), "closed 2");
assert.sameValue(fire("save", 3), "no save");
assert.sameValue(Object.keys(handlers).join(","), "open,close");
