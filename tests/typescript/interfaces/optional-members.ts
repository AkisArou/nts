/*---
description: An optional interface member that is absent reads as undefined, and an optional method is called through `?.`.
features: [ts-interfaces, ts-optional-properties, ts-optional-chaining]
---*/
interface Options {
  retries?: number;
  onDone?(count: number): string;
}
function run(options: Options): string {
  const retries = options.retries ?? 1;
  return options.onDone?.(retries) ?? `no callback (${retries})`;
}
assert.sameValue(run({}), "no callback (1)");
assert.sameValue(run({ retries: 0 }), "no callback (0)");
assert.sameValue(run({ retries: 3, onDone: (n) => `done ${n}` }), "done 3");
const bare: Options = {};
assert.sameValue("retries" in bare, false);
