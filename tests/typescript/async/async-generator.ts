/*---
description: An async generator yields typed values that for-await reads one at a time.
features: [ts-async, ts-async-generators, ts-generators]
flags: [async]
---*/
async function* countdown(from: number): AsyncGenerator<number, string> {
  for (let n = from; n > 0; n--) {
    await null;
    yield n;
  }
  return "liftoff";
}
async function main(): Promise<void> {
  const seen: number[] = [];
  for await (const n of countdown(3)) seen.push(n);
  assert.compareArray(seen, [3, 2, 1]);
  const gen = countdown(1);
  assert.sameValue((await gen.next()).value, 1);
  const end = await gen.next();
  assert.sameValue(end.done, true);
  assert.sameValue(end.value, "liftoff");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
