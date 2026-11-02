/*---
description: flatMap rejects a string mapper result when first pulled through a typed return.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-functions]
---*/
// flatMap; typed return; string triggers TypeError after first pull/callback; node throws.
function* source(values: number[], log: string[]): Generator<number> {
  try {
    for (const value of values) {
      log.push("pull:" + value);
      yield value;
    }
  } finally {
    log.push("return");
  }
}
function route(input: IteratorObject<number>, log: string[]): IteratorObject<string> {
  return input.flatMap((value, index) => {
    log.push("flat:" + value + ":" + index);
    return "wrong";
  });
}
for (const values of [[1, 2], [9]]) {
  const log: string[] = [];
  const helper: IteratorObject<string> = route(source(values, log), log);
  assert.compareArray(log, []);
  assert.throws(TypeError, () => helper.next());
  assert.compareArray(log, ["pull:" + values[0], "flat:" + values[0] + ":0", "return"]);
}
