/*---
description: "Control: Breaking two async delegation levels through a typed instance method; node closes inner, awaits middle cleanup, then awaits outer cleanup before continuing."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-generators, ts-class, ts-unions, ts-arrow-functions]
flags: [async]
---*/
// Breaking two async delegation levels through a typed instance method; node closes inner, awaits middle cleanup, then awaits outer cleanup before continuing.
const log: string[] = [];
function* inner(input: number[]): Generator<number | Promise<number>, void, void> {
  try { log.push("inner:start"); for (const value of input) { log.push("inner:" + value); yield Promise.resolve(value); } }
  finally { log.push("inner:finally"); }
}
class Reader {
  async take(input: number[], limit: number): Promise<number[]> {
    const values: number[] = [], source = inner(input);
    try {
      log.push("outer:start"); try {
        log.push("middle:start"); let done = false;
        try { while (true) { const step = source.next(); if (step.done) { await step.value; done = true; break; }
          const value = await step.value; log.push("body:" + value); values.push(value); if (values.length === limit) break;
        } } finally { if (!done) await source.return(undefined).value; }
      } finally { log.push("middle:finally:start"); await Promise.resolve(); log.push("middle:finally:end"); }
    } finally { log.push("outer:finally:start"); await Promise.resolve(); log.push("outer:finally:end"); }
    log.push("after"); return values;
  }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) for (const limit of [1, 2]) {
    log.length = 0; const values = await new Reader().take(input, limit); const expected = ["outer:start", "middle:start", "inner:start"];
    for (const value of input.slice(0, limit)) expected.push("inner:" + value, "body:" + value);
    expected.push("inner:finally", "middle:finally:start", "middle:finally:end", "outer:finally:start", "outer:finally:end", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, limit));
    assert.sameValue(values.length, Math.min(input.length, limit));
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
