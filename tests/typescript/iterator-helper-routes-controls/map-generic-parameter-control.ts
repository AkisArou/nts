/*---
description: Explicit generator pulls and indexed mapping through a generic parameter.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-generics]
---*/
// map control; generic parameter; same pulls and callback positions; node yields 2, 4.
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

function route<T extends number>(it: Iterator<T>, log: string[]): Iterator<number> {
  let index = 0;
  return {
    next(): IteratorResult<number> {
      const result = it.next();
      if (result.done) return { value: undefined, done: true };
      log.push("map:" + result.value + ":" + index++);
      return { value: result.value * 2, done: false };
    }
  };
}
for (const values of [[1, 2, 3], [4], []]) {
  const log: string[] = [];
  const mapped: Iterator<number> = route(source(values, log), log);
  assert.compareArray(log, []);
  const got = mapped.next();
  assert.sameValue(got.value, values.length ? values[0] * 2 : undefined);
  assert.sameValue(got.done, values.length === 0);
  assert.compareArray(log, values.length ? ["pull:" + values[0], "map:" + values[0] + ":0"] : ["return"]);
  if (values.length) {
    assert.sameValue(mapped.next().value, values.length > 1 ? values[1] * 2 : undefined);
    const expected = values.length > 1
      ? ["pull:" + values[0], "map:" + values[0] + ":0", "pull:" + values[1], "map:" + values[1] + ":1"]
      : ["pull:" + values[0], "map:" + values[0] + ":0", "return"];
    assert.compareArray(log, expected);
  }
}
