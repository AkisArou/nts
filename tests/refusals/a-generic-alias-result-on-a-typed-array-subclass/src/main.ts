// expect: emit-c --napi -> calls typeof exports.aliasBacking === "undefined"
// control: exports.directBacking(17) === 21
//
// The honest Node26 Buffer split names its generic backing view through a
// type alias. The two factory results below are exactly the same TypeScript
// type, and both bodies construct the same view. Changing only the result
// annotation from its generic alias to the class name makes the call compile.
// The lost local/slowbuffer-length-static.js pass stays attributed here.
// The migration keeps the honest source; its Buffer floor may be acknowledged
// by this fixture's name until the compiler fix restores the pass.

class Bytes<T extends ArrayBufferLike = ArrayBufferLike> extends Uint8Array<T> {
  constructor(buffer: T) { super(buffer); }
}

// An alpha-renamed copy isolates the control's specialization: putting both
// factories through Bytes lets the aliased path poison the direct control too.
// In independent projects, changing only ByteView<ArrayBuffer> below to
// Bytes<ArrayBuffer> restores the same compiled call (21 on input 17).
class DirectBytes<T extends ArrayBufferLike = ArrayBufferLike> extends Uint8Array<T> {
  constructor(buffer: T) { super(buffer); }
}

type ByteView<T extends ArrayBufferLike = ArrayBufferLike> = Bytes<T>;

function createThroughAlias(size: number): ByteView<ArrayBuffer> {
  return new Bytes(new ArrayBuffer(size));
}

function createThroughClass(size: number): DirectBytes<ArrayBuffer> {
  return new DirectBytes(new ArrayBuffer(size));
}

export function aliasBacking(value: number): number {
  const bytes = createThroughAlias(4);
  bytes[1] = value;
  return bytes[1]! + bytes.length;
}

export function directBacking(value: number): number {
  const bytes = createThroughClass(4);
  bytes[1] = value;
  return bytes[1]! + bytes.length;
}
