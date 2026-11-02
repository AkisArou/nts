/*---
description: A mapped generator crosses a constrained generic parameter and advances lazily.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-generics]
---*/
// map; generic parameter; exact pull and indexed callback order; node yields 2, 4.
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

function route<T extends number>(it: IteratorObject<T>, log: string[]): IteratorObject<number> {
  return it.map((value, index) => {
    log.push("map:" + value + ":" + index);
    return value * 2;
  });
}
for (const values of [[1, 2, 3], [4], []]) {
  const log: string[] = [];
  const mapped: IteratorObject<number> = route(source(values, log), log);
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
