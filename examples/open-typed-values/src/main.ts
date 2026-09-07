// A typed array and a buffer that arrived as `unknown`, asked what they are.
//
// `instanceof` against a typed array cannot go the way it goes for a class.
// All nine share one struct and one descriptor -- they differ only in how their
// bytes are read -- so there is no per-class layout to compare against, and the
// search that answers `x instanceof Point` finds nothing and says "something
// this compiler has no class for". True, and about the representation rather
// than about the question.
//
// The runtime answers it in two parts: the descriptor says *some typed array*
// and the view's `kind` field says *which*.
//
// ONLY ONE OF THE TWO IS VISIBLE HERE, and it is worth saying which. Dropping
// the kind test gives 29 disagreements below -- every `Float32Array` becomes a
// `Uint8Array`. Dropping the DESCRIPTOR test gives **none**: the cases still
// agree on all 261, because reading a `kind` field out of an object that has no
// such field reads past the allocation, and what is there today happens not to
// equal 1. That is undefined behaviour answering correctly, which is the one
// thing a differential cannot tell from correctness.
//
// So the descriptor half is unguarded on this lane and the sabotage proving it
// is in the record rather than in a case that pretends otherwise. The
// instrument that can see it is the JVM backend, where reading a field a class
// does not declare does not return a stale byte -- it fails to verify. That is
// the third time the checked-cast lane has been the only thing able to see a
// lie about a type, and it is why a representation change goes to that session
// before it lands.
//
// None of this was answerable before `ManagedType::View`. While a `Uint8Array`
// and a `number[]` were one representation with one descriptor there was
// nothing to compare, which is the same reason `Array.isArray` of an open value
// was refused.

function bytes(n: number): Uint8Array {
  const view = new Uint8Array(2);
  view[0] = n;
  return view;
}

// The narrowing has to be *read back*, not merely decided: `open[0]` is a load
// through a value the checker has narrowed to `Uint8Array`, and the lowering
// has a separate whitelist for what an `unknown` can be read back as. That list
// and the one for what can be erased *into* an `unknown` had drifted apart --
// a view could go in and not come out -- so a case that only tested the boolean
// would have passed against a compiler that could not use the answer.
export function readBackAfterNarrowing(n: number): number {
  const open: unknown = bytes(n);
  if (open instanceof Uint8Array) {
    return open[0]! * 10 + open.length;
  }
  return -1;
}

// The discriminator between the two halves of the test. A `Uint8Array` is not a
// `Float32Array`, and both carry the same descriptor.
export function oneKindIsNotAnother(n: number): number {
  const open: unknown = bytes(n);
  return (open instanceof Uint8Array ? 1 : 0) +
    (open instanceof Float32Array ? 10 : 0) +
    (open instanceof Int8Array ? 100 : 0);
}

// A thing that is not a view at all. This is the case that *should* separate
// the descriptor half, and by itself it does not -- see the header. It is kept
// because it is the shape the property is about, and because the byte it reads
// past the allocation is not guaranteed to stay uninteresting: a layout change
// could make this case start biting, and a case that may begin to distinguish
// is worth more than none.
export function anOrdinaryArrayIsNotAView(n: number): number {
  const open: unknown = [n, n + 1];
  return (open instanceof Uint8Array ? 1 : 0) +
    (Array.isArray(open) ? 10 : 0);
}

class Point {
  constructor(public x: number) {}
}

export function anObjectIsNotAView(n: number): number {
  const open: unknown = new Point(n);
  return open instanceof Uint8Array ? 1 : 0;
}

export function aStringIsNotAView(n: number): number {
  const open: unknown = n > 0 ? "ab" : "c";
  return open instanceof Uint8Array ? 1 : 0;
}

export function aNumberIsNotAView(n: number): number {
  const open: unknown = n;
  return open instanceof Uint8Array ? 1 : 0;
}

// A buffer is one class rather than nine, so its kind is the whole answer --
// and a view is not its buffer, which is the case that separates the two tests.
export function aBufferIsNotItsView(n: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new Uint8Array(buffer);
  view[0] = n;
  const openBuffer: unknown = buffer;
  const openView: unknown = view;
  return (openBuffer instanceof ArrayBuffer ? 1 : 0) +
    (openView instanceof ArrayBuffer ? 10 : 0) +
    (openBuffer instanceof Uint8Array ? 100 : 0) +
    (openView instanceof Uint8Array ? 1000 : 0);
}

export function readBackABuffer(n: number): number {
  const open: unknown = new ArrayBuffer(n > 0 ? 8 : 4);
  if (open instanceof ArrayBuffer) {
    return open.byteLength;
  }
  return -1;
}

// A window over part of a buffer is still that kind, and its own length.
export function aWindowKeepsItsKind(offset: number): number {
  try {
    const window = new Uint16Array(new ArrayBuffer(16), offset, 2);
    const open: unknown = window;
    if (open instanceof Uint16Array) {
      return open.length * 10 + open.byteLength;
    }
    return -1;
  } catch {
    return -2;
  }
}
