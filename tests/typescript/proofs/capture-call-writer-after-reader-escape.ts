/*---
description: A reader published before its writer is returned still shares the binding with that writer.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-function-types, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the reader escapes before the writer returns; node keeps both on the same live cell.
function create(publish: (read: () => number) => void): (n: number) => void {
  let value = 0;
  const read = (): number => value;
  publish(read);
  return (n: number): void => { value = n; };
}
function afterWrite(n: number): number {
  const holder: { read: () => number } = { read: () => -1 };
  const write = create(read => { holder.read = read; });
  write(n);
  return holder.read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterWrite(n), n);
