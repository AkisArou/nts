/*---
description: Explicit flattened inner arrays returned through the same typed tuple.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-tuples]
---*/
// flatMap control; tuple return; inner array drained before outer next; node yields [1,11,2,12].
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

function make(values: number[], log: string[]): [Iterator<number>, string[]] {
  const outer: Iterator<number> = source(values, log);
  let inner: number[] = [];
  let offset = 0;
  let index = 0;
  const result: Iterator<number> = {
    next(): IteratorResult<number> {
      while (true) {
        if (offset < inner.length) return { value: inner[offset++], done: false };
        const step = outer.next();
        if (step.done) return { value: undefined, done: true };
        log.push("flat:" + step.value + ":" + index++);
        inner = [step.value, step.value + 10];
        offset = 0;
      }
    }
  };
  return [result, log];
}
for (const values of [[1, 2], [3], []]) {
  const log: string[] = [];
  const pair: [Iterator<number>, string[]] = make(values, log);
  assert.compareArray(pair[1], []);
  const out: number[] = [];
  while (true) {
    const step = pair[0].next();
    if (step.done) break;
    out.push(step.value);
  }
  const expected: string[] = [];
  const wanted: number[] = [];
  for (let i = 0; i < values.length; i++) {
    expected.push("pull:" + values[i], "flat:" + values[i] + ":" + i);
    wanted.push(values[i], values[i] + 10);
  }
  expected.push("return");
  assert.compareArray(out, wanted);
  assert.compareArray(log, expected);
}
