/*---
description: An array reader sees mutation and then a replacement array across separate awaits.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-async, ts-arrays, ts-numbers]
flags: [async]
---*/
// Route: a captured number-array binding mutated and rebound around await; node observes every write in order.
const inputs: number[] = [0, -0, NaN, 0.25, 2147483648, 4294967297, Infinity, -Infinity];
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
async function main(): Promise<void> {
  for (const input of inputs) {
    let value: number[] = [1]; const original: number[] = value; const log: string[] = ["write:initial"];
    const read: () => number[] = () => { log.push("read"); return value; };
    const first = read(); captureCheck(first, original, "object"); assert.sameValue(first.length, 1); captureCheck(first[0], 1, "number");
    value.push(input); log.push("write:push"); log.push("await:first"); await Promise.resolve(); log.push("resume:first");
    const second = read(); captureCheck(second, original, "object"); assert.sameValue(second.length, 2); captureCheck(second[1], input, "number");
    value = [input, 2]; log.push("write:replace"); log.push("await:second"); await Promise.resolve(); log.push("resume:second");
    const third = read(); captureCheck(third, value, "object"); assert.sameValue(Object.is(third, original), false);
    assert.sameValue(third.length, 2); captureCheck(third[0], input, "number"); captureCheck(third[1], 2, "number");
    captureCheck(original[0], 1, "number"); captureCheck(original[1], input, "number"); assert.sameValue(original.length, 2);
    assert.compareArray(log, ["write:initial", "read", "write:push", "await:first", "resume:first", "read", "write:replace", "await:second", "resume:second", "read"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
