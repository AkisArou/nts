/*---
description: A captured definite local retains undefined until a returned callback assigns it, including empty-string assignments.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-definite-assignment, ts-interfaces, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-iteration, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator]
---*/
// A definite local claim crosses a returned callback interface; node logs undefined before assignment and keeps the exact text after each callback call.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface DeferredText { read(): string; write(): void; }
function create(next: string, log: unknown[]): DeferredText {
  let pending!: string;
  log.push("created", pending);
  return {
    read() { log.push("read", pending); return pending; },
    write() { log.push("write", next); pending = next; }
  };
}
for (const next of ["", "later", "0"]) {
  const log: unknown[] = [], slot = create(next, log);
  same(slot.read(), undefined);
  slot.write(); same(slot.read(), next);
  slot.write(); same(slot.read(), next);
  const expected: unknown[] = ["created", undefined, "read", undefined, "write", next, "read", next, "write", next, "read", next];
  assert.compareArray(log, expected);
  for (let index = 0; index < log.length; index++) same(log[index], expected[index]);
}
