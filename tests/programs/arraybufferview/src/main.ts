// `ArrayBufferView`, which is not a typed array and is how node says "a view".
//
// Every node API that takes some view is declared this way, because
// `ArrayBufferView` is the interface a `Uint8Array`, a `Float64Array` and a
// `DataView` all satisfy. It has no element type, and inventing one would be
// stating a fact the source did not.
//
// So `ManagedType::AnyView` carries no element, and what can be asked of one is
// what does not need the width: `byteLength`, `byteOffset` and the backing
// buffer. `NtsView` knows its own element kind at run time -- the descriptor
// carries it -- so a value of this type is an ordinary `NtsView *` and a native
// binding taking one needs nothing new.
//
// `length` is refused by name, and deliberately: it is `byteLength` divided by
// the element size, and the declaration does not give the size. A refusal that
// points at `byteLength` is a better answer than a number computed from a width
// nobody stated.
//
// **The JVM backend refuses every function reaching this type**, uniformly and
// by name -- `an ArrayBufferView with no element type`. `NtsViewU8` and
// `NtsViewF64` are different classes there, so no single descriptor covers
// both, and `Ljava/lang/Object;` would load and then fail the verifier at the
// first use. A refusal that greps is worth more than a descriptor that is wrong
// three days later, which is the trade that lane asked for.

function bytesIn(view: ArrayBufferView): number {
  return view.byteLength;
}

function offsetIn(view: ArrayBufferView): number {
  return view.byteOffset;
}

// A `Uint8Array` where a view is wanted. Base-first is not the reason this
// works -- there is no hierarchy here -- it is that both are one `NtsView *`
// and the element type was only ever a fact the compiler carried.
export function bytesOfABuffer(n: number): number {
  const size = n > 0 && n < 100 ? n : 4;
  return bytesIn(new Uint8Array(size));
}

// A wider element, so the answer is bytes rather than elements and the two
// differ. `Float64Array(3)` is 24 bytes and 3 elements, and `byteLength` is the
// one this type can answer.
export function bytesOfDoubles(n: number): number {
  const size = n > 0 && n < 50 ? n : 3;
  return bytesIn(new Float64Array(size));
}

// The offset of a view that starts at zero, and of one that does not. A view
// over a slice of a buffer carries its own offset, and reading it needs no
// width either.
export function offsetOfAWholeView(n: number): number {
  const size = n > 0 && n < 50 ? n : 4;
  return offsetIn(new Uint8Array(size));
}

// Both answers from one value, so the two helpers are not being told apart by
// the call site's shape.
export function bothOfOne(n: number): number {
  const size = n > 0 && n < 50 ? n : 4;
  const view = new Uint8Array(size);
  return bytesIn(view) * 1000 + offsetIn(view);
}

// Through a local declared at the interface type rather than at the call, which
// is where the assignment happens rather than the argument passing.
export function throughADeclaration(n: number): number {
  const size = n > 0 && n < 50 ? n : 4;
  const held: ArrayBufferView = new Uint16Array(size);
  return held.byteLength;
}

// --- back out again -------------------------------------------------------
//
// The half that makes this a representation rather than a trapdoor. A BYOB
// stream hands a caller back a view of the *same type* they passed, so the
// element type has to survive a round trip through `ArrayBufferView` -- out by
// declaration, back in by `instanceof`.
//
// Discriminating always worked: `instanceof` on one of these is
// `nts_is_view_kind`, which reads the element kind out of the descriptor.
// Reconstructing did not, and half a round trip is worse than refusing both --
// the program has just proved the type and the compiler still says it does not
// know it.
//
// Both directions are one `NtsView *`, so the narrowing is a reinterpretation
// with nothing to convert.

function widthOf(view: ArrayBufferView): number {
  if (view instanceof Uint8Array) {
    return 1;
  }
  if (view instanceof Uint16Array) {
    return 2;
  }
  if (view instanceof Float64Array) {
    return 8;
  }
  return 0;
}

export function discriminates(n: number): number {
  const size = n > 0 && n < 50 ? n : 4;
  return widthOf(new Uint8Array(size)) * 100
    + widthOf(new Uint16Array(size)) * 10
    + widthOf(new Float64Array(size));
}

// `length` rather than `byteLength`, which is the question `AnyView` cannot
// answer and the narrowed view can. Three elements of a `Float64Array` are 24
// bytes, and getting the two confused is the failure this checks for.
function elementsIn(view: ArrayBufferView): number {
  if (view instanceof Float64Array) {
    return view.length;
  }
  if (view instanceof Uint8Array) {
    return view.length;
  }
  return -1;
}

export function countsElements(n: number): number {
  const size = n > 0 && n < 50 ? n : 3;
  return elementsIn(new Float64Array(size)) * 1000 + elementsIn(new Uint8Array(size));
}

// Reading an element through the narrowed view, which needs the width to be
// right rather than merely present.
function firstOf(view: ArrayBufferView): number {
  if (view instanceof Uint16Array) {
    if (view.length === 0) {
      return -1;
    }
    return view[0]!;
  }
  return -1;
}

export function readsThrough(n: number): number {
  // Whole and at least one, so the read below is in range for every input the
  // differential feeds rather than for most of them.
  const size = ((n > 0 && n < 50 ? n : 4) | 0) + 1;
  const held = new Uint16Array(size);
  // Through a `Uint16Array`, so the value wraps at 16 bits rather than being
  // stored whole -- which is the width mattering rather than merely existing.
  held[0] = n > 0 && n < 100000 ? n : 7;
  return firstOf(held);
}

// A view that is not any of the tested kinds falls through, so the guard is
// deciding rather than the call site.
export function unmatchedFallsThrough(n: number): number {
  const size = n > 0 && n < 50 ? n : 4;
  return elementsIn(new Uint16Array(size));
}
