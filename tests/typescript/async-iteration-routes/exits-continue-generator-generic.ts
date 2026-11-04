/*---
description: "Continue resumes a generic async generator and delays finally until normal completion."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-generics, ts-generic-constraints]
flags: [async]
---*/
// A generic consumer walks number and string generators; node resumes each continued yield, skips only that body tail, and runs finally after all values.
const log: string[] = [];
async function* produce<T extends number | string>(values: readonly T[], label: string): AsyncIterableIterator<T, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally"); }
}
async function consume<T extends number | string>(source: AsyncIterable<T>): Promise<T[]> { log.push("consume"); const seen: T[] = []; let index = 0;
  for await (const value of source) { log.push("body:" + String(value)); seen.push(value); if (index++ % 2 === 0) { log.push("continue"); continue; } log.push("tail"); }
  log.push("after"); return seen;
}
async function check<T extends number | string>(items: readonly T[]): Promise<void> {
  const source = produce<T>(items, "it"); log.length = 0; const seen = await consume<T>(source); log.push("caller"); const expected = ["consume", "it:start"];
  for (let index = 0; index < items.length; index++) { if (index > 0) expected.push("it:resume:" + String(items[index - 1])); expected.push("it:yield:" + String(items[index]), "body:" + String(items[index]), index % 2 === 0 ? "continue" : "tail"); }
  if (items.length > 0) expected.push("it:resume:" + String(items[items.length - 1])); expected.push("it:end", "it:finally", "after", "caller");
  assert.compareArray(log, expected); assert.compareArray(seen, items);
}
async function main(): Promise<void> { await check<number>([]); await check<number>([2, 4, 6]); await check<string>([]); await check<string>(["a", "b", "c"]); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
