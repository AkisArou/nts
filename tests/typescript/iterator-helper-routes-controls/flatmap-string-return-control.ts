/*---
description: Explicit flatMap-like validation rejects primitive string mapper results.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-functions]
---*/
// flatMap control; typed return; reject string after first pull/callback; node throws.
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
function route(input: Iterator<number>, log: string[]): Iterator<string> {
  let index = 0;
  return {
    next(): IteratorResult<string> {
      const result = input.next();
      if (result.done) return { value: undefined, done: true };
      log.push("flat:" + result.value + ":" + index++);
      const mapped: string = "wrong";
      if (typeof mapped === "string") {
        input.return?.();
        throw new TypeError("flatMap mapper returned a string");
      }
      return { value: undefined, done: true };
    }
  };
}
for (const values of [[1, 2], [9]]) {
  const log: string[] = [];
  const helper: Iterator<string> = route(source(values, log), log);
  assert.compareArray(log, []);
  assert.throws(TypeError, () => helper.next());
  assert.compareArray(log, ["pull:" + values[0], "flat:" + values[0] + ":0", "return"]);
}
