/*---
description: A microtask can replace the known receiver while its caller is suspended.
features: [ts-proof-call-target, ts-route-suspension, ts-functions, ts-iteration, ts-async, ts-closures, ts-objects, ts-class, ts-inheritance]
flags: [async]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: await lets the queued writer replace Base; node resumes with Next as the target.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

async function afterAwait(n: number): Promise<number> {
  const holder: { target: Base } = { target: new Base() };
  const write = Promise.resolve().then(() => {
    if (n > 0) holder.target = new Next();
  });
  await write;
  return holder.target.run(n);
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    assert.sameValue(await afterAwait(n), (n > 0 ? 200 : 100) + n);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
