/*---
description: A bound capturing function writes the binding observed by its sibling reader.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-function-types, ts-this, ts-class, ts-class-fields, ts-this-parameter]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the fixed-arity bound writer assigns the outer binding; node uses the instance receiver.
class Receiver { offset = 2; }
function afterWrite(n: number): number {
  let value = 0;
  const read = (): number => value;
  function write(this: Receiver, next: number): void { value = this.offset + next; }
  const bound = write.bind(new Receiver(), n);
  bound();
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterWrite(n), n + 2);
