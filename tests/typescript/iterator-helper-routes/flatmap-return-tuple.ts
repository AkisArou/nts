/*---
description: A flatMapped iterator returned through a typed tuple preserves outer and inner ordering.
features: [ts-iteration, ts-iterator-helper-route-mapping, ts-tuples]
---*/
// flatMap; tuple return; both inner values before next outer pull; node yields [1,11,2,12].
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

function make(values: number[], log: string[]): [IteratorObject<number>, string[]] {
  return [source(values, log).flatMap((value, index) => {
    log.push("flat:" + value + ":" + index);
    return [value, value + 10];
  }), log];
}
for (const values of [[1, 2], [3], []]) {
  const log: string[] = [];
  const pair: [IteratorObject<number>, string[]] = make(values, log);
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
