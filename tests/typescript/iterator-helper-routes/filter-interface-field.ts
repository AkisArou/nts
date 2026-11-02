/*---
description: Filtering through an interface field pulls rejected values and counts every callback.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-interfaces]
---*/
// filter; interface field; pulls through rejects and counter increments; node yields even values.
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

interface Slot { current: IteratorObject<number> }
for (const values of [[1, 2, 3, 4], [2], []]) {
  const log: string[] = [];
  const slot: Slot = { current: source(values, log) };
  slot.current = slot.current.filter((value, index) => {
    log.push("filter:" + value + ":" + index);
    return value % 2 === 0;
  });
  assert.compareArray(log, []);
  const results = slot.current.toArray();
  assert.compareArray(results, values.filter(value => value % 2 === 0));
  const expected: string[] = [];
  for (let i = 0; i < values.length; i++) {
    expected.push("pull:" + values[i], "filter:" + values[i] + ":" + i);
  }
  expected.push("return");
  assert.compareArray(log, expected);
}
