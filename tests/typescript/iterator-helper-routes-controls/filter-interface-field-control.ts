/*---
description: Explicit filtering through the same interface field and callback history.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-interfaces]
---*/
// filter control; interface field; explicit next loop and callback counter; node yields even values.
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

interface Slot { current: Iterator<number> }
for (const values of [[1, 2, 3, 4], [2], []]) {
  const log: string[] = [];
  const slot: Slot = { current: source(values, log) };
  const original = slot.current;
  let index = 0;
  slot.current = {
    next(): IteratorResult<number> {
      while (true) {
        const result = original.next();
        if (result.done) return { value: undefined, done: true };
        log.push("filter:" + result.value + ":" + index++);
        if (result.value % 2 === 0) return { value: result.value, done: false };
      }
    }
  };
  assert.compareArray(log, []);
  const results: number[] = [];
  while (true) {
    const result = slot.current.next();
    if (result.done) break;
    results.push(result.value);
  }
  assert.compareArray(results, values.filter(value => value % 2 === 0));
  const expected: string[] = [];
  for (let i = 0; i < values.length; i++) {
    expected.push("pull:" + values[i], "filter:" + values[i] + ":" + i);
  }
  expected.push("return");
  assert.compareArray(log, expected);
}
