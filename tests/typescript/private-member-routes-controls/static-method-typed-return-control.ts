/*---
description: A returned static private method has stable function identity but keeps a dynamic receiver. Control with explicit constructor checks.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-inheritance, ts-objects, ts-unknown, ts-this, ts-this-parameter, ts-tuples]
---*/
// StaticReader returns a private method through an explicit function type; node preserves its identity and rejects a detached call whose receiver lacks the static field.
let secret: unknown = undefined;
function readSecret(this: object): unknown { if (this !== StaticReader) throw new TypeError(); return secret; }
class StaticReader {
  static reader(): (this: object) => unknown { if (this !== StaticReader) throw new TypeError(); return readSecret; }
  static write(value: unknown): unknown { if (this !== StaticReader) throw new TypeError(); return secret = value; }
}
class StaticChild extends StaticReader {}
function extract(receiver: typeof StaticReader): (this: object) => unknown { return receiver.reader(); }
const reader = extract(StaticReader);
const values: unknown[] = [-0, NaN, "", undefined, { id: 1 }, [1]];
const receivers: [object, boolean][] = [[StaticReader, true], [StaticChild, false], [new StaticReader(), false], [{ value: 1 }, false]];
for (const value of values) {
  assert.sameValue(StaticReader.write(value), value);
  assert.sameValue(extract(StaticReader), reader); assert.sameValue(StaticReader.reader(), reader);
  assert.throws(TypeError, () => extract(StaticChild));
  for (const [receiver, valid] of receivers) {
    if (valid) assert.sameValue(reader.call(receiver), value);
    else assert.throws(TypeError, () => reader.call(receiver));
  }
  assert.sameValue(reader.call(StaticReader), value);
}
