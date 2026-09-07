// Two views naming the same bytes, which is the property `ManagedType::View`
// exists for.
//
// `examples/typed-arrays` does not test it. Every one of its 292 cases would
// pass against a lowering that *copied* instead of aliasing, because nothing in
// it can make two views of one buffer: no `subarray`, no `.buffer` handed to a
// second constructor, no overlapping `set`. All three are here. The representation landed and the
// thing it was chosen for went unexercised — which is the shape of gap that a
// bigger corpus does not close, because no input reaches it.
//
// So this file is the aliasing, deliberately: every function here would give a
// different answer if a view copied.
const RANGE = -1;
const OTHER = -2;

function thrown(error: unknown): number {
  return error instanceof RangeError ? RANGE : OTHER;
}

// One buffer, two widths. Writing bytes must be visible as a word, and the
// reverse — checked both ways, so a one-directional accident is not mistaken
// for aliasing.
export function bytesSeenAsAWord(a: number, b: number): number {
  try {
    const buffer = new ArrayBuffer(8);
    const bytes = new Uint8Array(buffer);
    const words = new Uint32Array(buffer);
    bytes[0] = a;
    bytes[1] = b;
    return words[0]!;
  } catch (error) {
    return thrown(error);
  }
}

export function aWordSeenAsBytes(n: number): number {
  try {
    const buffer = new ArrayBuffer(8);
    const bytes = new Uint8Array(buffer);
    const words = new Uint32Array(buffer);
    words[0] = n;
    return bytes[0]! + bytes[1]! * 256;
  } catch (error) {
    return thrown(error);
  }
}

// A window's own offset and length, which are not its buffer's.
export function windowGeometry(offset: number, length: number): number {
  try {
    const buffer = new ArrayBuffer(16);
    const window = new Uint8Array(buffer, offset, length);
    return window.byteOffset * 1000 + window.byteLength * 10 + window.length;
  } catch (error) {
    return thrown(error);
  }
}

// A view with no length follows its buffer; a subarray keeps what it was cut
// to. The two differ only on a resizable buffer, which is what makes it a real
// distinction rather than an implementation detail.
export function trackingFollowsAResize(max: number, grown: number): number {
  try {
    const buffer = new ArrayBuffer(4, { maxByteLength: max });
    const tracks = new Uint8Array(buffer);
    const cut = tracks.subarray(0, 2);
    buffer.resize(grown);
    return tracks.length * 100 + cut.length;
  } catch (error) {
    return thrown(error);
  }
}

// `subarray` aliases and `slice` copies. Writing through the original must move
// one and not the other, which is the case that fails if they are the same.
export function subarrayAliasesAndSliceDoesNot(n: number): number {
  try {
    const whole = new Uint8Array(4);
    whole[1] = 7;
    const window = whole.subarray(1, 3);
    const copy = whole.slice(1, 3);
    whole[1] = n;
    return window[0]! * 1000 + copy[0]!;
  } catch (error) {
    return thrown(error);
  }
}

// Seen from the other end: writing through the window moves the original.
export function writingThroughAWindow(n: number): number {
  try {
    const whole = new Uint8Array(4);
    const window = whole.subarray(2, 4);
    window[0] = n;
    return whole[2]!;
  } catch (error) {
    return thrown(error);
  }
}

// `set` between two windows over one buffer, at one width. Specified as if the
// source were snapshotted, so it is right only when the overlap is handled.
export function setBetweenOverlappingWindows(a: number, b: number): number {
  try {
    const whole = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      whole[i] = i + 1;
    }
    whole[0] = a;
    whole[1] = b;
    const destination = whole.subarray(2, 6);
    const source = whole.subarray(0, 4);
    destination.set(source, 0);
    return whole[2]! * 1000 + whole[3]! * 100 + whole[4]! * 10 + whole[5]!;
  } catch (error) {
    return thrown(error);
  }
}

// `copyWithin` with the destination past the source: reads what it has already
// written unless the copy moves rather than loops.
export function copyWithinOverlaps(n: number): number {
  try {
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      bytes[i] = i + 1;
    }
    bytes[0] = n;
    bytes.copyWithin(2, 0, 5);
    return bytes[2]! * 1000 + bytes[3]! * 100 + bytes[4]! * 10 + bytes[5]!;
  } catch (error) {
    return thrown(error);
  }
}

// A window of a WIDER element, which separates a kind from a width.
// `nts_view_new` derives the width from the kind and the two agree only at one
// byte, so a `subarray` that passed the width made a `Uint16Array`'s window
// claim to be a clamped byte array.
//
// `byteLength` is the discriminator and the reason this function returns it.
// Indexed access is emitted from the *HIR* element type, so `window[0]` reads
// two bytes at the right offset whatever the runtime kind says — every read
// looks fine, and only the byte length and the conversions `set` goes through
// are wrong. A case that returned elements and a length could not tell the two
// implementations apart, and the first version of this one did not.
export function windowOfAWiderElement(a: number, b: number): number {
  try {
    const words = new Uint16Array(4);
    words[0] = a;
    words[1] = b;
    words[2] = 4000;
    const window = words.subarray(1, 3);
    return window[0]! * 100000 + window.byteLength * 10 + window.length;
  } catch (error) {
    return thrown(error);
  }
}

// And through a slice, which copies but must copy at the right width.
export function copyOfAWiderElement(a: number): number {
  try {
    const words = new Uint32Array(3);
    words[0] = a;
    words[1] = 70000;
    const copy = words.slice(0, 2);
    return copy[1]! + copy.length;
  } catch (error) {
    return thrown(error);
  }
}

// An offset that is not a multiple of the element width cannot start an
// element half way through itself.
export function misalignedOffset(offset: number): number {
  try {
    return new Uint16Array(new ArrayBuffer(16), offset).length;
  } catch (error) {
    return thrown(error);
  }
}

// A window that does not fit, and one that starts past the end. Node
// distinguishes the two.
export function windowPastTheEnd(offset: number, length: number): number {
  try {
    return new Uint8Array(new ArrayBuffer(8), offset, length).length;
  } catch (error) {
    return thrown(error);
  }
}

// The third route to two views of one buffer, and the one this file's header
// listed as missing: `.buffer` handed to a second constructor. It arrives here
// from `examples/unsupported`, where `new Uint8Array(4).buffer.byteLength` sat
// as a refusal under a comment arguing a typed array "is an array of a known
// width, not a view onto storage something else can also see". That was true of
// the representation and false of the language, and the comment outlived the
// condition by exactly one commit.
export function throughTheBufferProperty(n: number): number {
  try {
    const bytes = new Uint8Array(8);
    const words = new Uint32Array(bytes.buffer);
    words[0] = n;
    return bytes[0]! + bytes[1]! * 256;
  } catch (error) {
    return thrown(error);
  }
}

// A window's buffer is the WHOLE buffer, not the window. A lowering that made
// `.buffer` hand back storage the size of the view -- which is what copying
// would give -- returns the window's own length here instead of sixteen, and
// the second view sees four elements rather than every one.
export function aWindowsBufferIsTheWholeBuffer(offset: number): number {
  try {
    const window = new Uint8Array(new ArrayBuffer(16), offset, 4);
    return window.buffer.byteLength * 100 + new Uint8Array(window.buffer).length;
  } catch (error) {
    return thrown(error);
  }
}

// And writing through the window is visible in a view built from its buffer, at
// the window's offset rather than at zero.
export function aWindowWritesAtItsOffset(offset: number, value: number): number {
  try {
    const window = new Uint8Array(new ArrayBuffer(16), offset, 4);
    window[0] = value;
    const whole = new Uint8Array(window.buffer);
    return whole[offset]! * 1000 + whole[0]!;
  } catch (error) {
    return thrown(error);
  }
}

// `ToIndex` at the four places the pool does not reach.
//
// Each of these was a wrong answer, and the run above could not see any of
// them: 638 generated cases agreed on every one both before and after the fix,
// because the pool's fractions and its buffer sizes never met. So the inputs
// are written out rather than drawn -- a case only distinguishes what it
// actually evaluates, and a generator that produces neither `8.7` against an
// eight-byte buffer nor `NaN` in an offset produces confidence and no evidence.
//
// The rule under all four: truncate toward zero, THEN compare. Comparing the
// argument gives a different answer from comparing the index at every input
// where truncation moves the value across the bound -- which is every input
// below.

// `NaN > 8` is false, and so is every other comparison against it, so a raw
// guard passes NaN through to a runtime that converts it to zero and lays out
// fifteen elements over eight bytes. `ToIndex(NaN)` is 0 and `0 + 15 > 8`.
export function nanOffsetPastTheEnd(): number {
  try {
    return new Uint8Array(new ArrayBuffer(8), NaN, 15).length;
  } catch (error) {
    return thrown(error);
  }
}

// The other direction: a raw guard REFUSES a program node accepts, because
// `8.7 > 8` and `8 > 8` are not the same question. An offset at the very end
// is legal and makes an empty view.
export function fractionalOffsetAtTheEnd(): number {
  try {
    return new Uint8Array(new ArrayBuffer(8), 8.7).length;
  } catch (error) {
    return thrown(error);
  }
}

// And once more an addition later, where the sum of two arguments is compared
// instead of the sum of two indices. `0 + 8.9 > 8`; `0 + 8` is not.
export function fractionalLengthThatFits(): number {
  try {
    return new Uint8Array(new ArrayBuffer(8), 0, 8.9).length;
  } catch (error) {
    return thrown(error);
  }
}

export function fractionalOffsetAndLength(): number {
  try {
    return new Uint8Array(new ArrayBuffer(8), 7.9, 1).length;
  } catch (error) {
    return thrown(error);
  }
}

// The aligned-offset guard had the rule right all along, privately. Kept as a
// case so that removing its private conversion -- which this commit did, in
// favour of one conversion above it -- has to stay correct: offset 2 is
// aligned for a two-byte element and leaves six bytes, which is three of them.
export function fractionalOffsetStaysAligned(): number {
  try {
    return new Uint16Array(new ArrayBuffer(8), 2.9).length;
  } catch (error) {
    return thrown(error);
  }
}
