/*---
description: A dynamic import evaluates its module when called, once, and resolves to its namespace with typed exports.
features: [ts-modules, ts-dynamic-import, ts-async]
flags: [module, async]
---*/
async function main(): Promise<void> {
  const loads = (): number | undefined => (globalThis as { lazyLoads?: number }).lazyLoads;
  assert.sameValue(loads(), undefined);
  const lazy = await import("./lazy_FIXTURE.js");
  const again = await import("./lazy_FIXTURE.js");
  assert.sameValue(lazy.answer + 1, 43);
  assert.sameValue(lazy.describe(), "answer 42");
  assert.sameValue(again, lazy);
  assert.sameValue(loads(), 1);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
