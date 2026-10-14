// `SharedArrayBuffer` named in a signature, which is how the corpus writes it:
//
//     ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined
//
// 67 property sites and 27 parameter sites in `runtime/node` carry that union,
// and between them they were the largest single cause on the compiled axis. It
// reads as a union problem --- a union of three unlike reference types, which
// the union arm refuses because its members do not share a representation.
//
// # It was one missing member, found by varying one at a time
//
// ```text
// ArrayBuffer alone                lowers
// ArrayBufferView alone            lowers
// ArrayBufferView | ArrayBuffer    lowers
// SharedArrayBuffer alone          refused
// ```
//
// Every refusing spelling has `SharedArrayBuffer` in it and every lowering one
// does not. The name appeared **nowhere** in this compiler: `ArrayBuffer` maps
// to `ManagedType::Buffer` on one line and its twin had no entry at all, so
// every signature naming one refused and took its whole union with it.
//
// # Sharing a representation is not sharing an identity
//
// The two lay out identically --- a `SharedArrayBuffer` is the same bytes ---
// and `instanceof` is a **descriptor check at run time** rather than a question
// about the static type, so two types with one representation can still be
// told apart. That is how `Map` and `Set` share a struct and are separated by
// a `holds_values` bit.
//
// What this compiler does not have yet is a descriptor for a shared buffer, and
// `lower_new_provided` dispatches on the *representation* --- so
// `new SharedArrayBuffer(8)` built a value carrying `ArrayBuffer`'s descriptor
// and
//
//     s instanceof ArrayBuffer
//
// answered **true** where node answers false. That was measured rather than
// reasoned about: the probe came back `DISAGREE node=0 nts=1`. A wrong answer
// where this had been a missing one, which is the more expensive of the two.
//
// So `new SharedArrayBuffer` refuses **by name**, at the constructor, because
// one line further on the program is a `Buffer` and the question can no longer
// be asked. `blockers/a-new-shared-array-buffer` is that arm. With no way to
// construct one, every value a compiled program holds at that representation
// really is an `ArrayBuffer`, so `instanceof` stays right for the values that
// exist --- which `isAnArrayBuffer` below is here to keep true.
//
// Lifting the refusal means a descriptor of its own, after which `new` and
// `instanceof` both work rather than both refusing.
//
// # What this example does and does not cover
//
// The two-member union `ArrayBuffer | SharedArrayBuffer` lowers and its
// `byteLength` is readable, which is what the arms below assert.
//
// The **four**-member union the corpus writes lowers as a parameter --- that is
// the 81 sites --- but reading `byteLength` through it refuses with
// ``byteLength` on a union one of whose members has no layout`, because
// `ArrayBufferView` has none. That is a different obstacle from this one and it
// has its own fixture, `blockers/a-byte-length-through-a-view-union`. An arm
// that refuses is not written here: an example arm which disagrees with node is
// a known failure rather than a fixture.
//
// Measured on `runtime/node`: 1,576 refusal sites to 1,495.

function byteLengthOf(b: ArrayBuffer | SharedArrayBuffer): number {
  return b.byteLength;
}

export function throughAUnion(n: number): number {
  return byteLengthOf(new ArrayBuffer(4 + (n - n)));
}

export function aBiggerOne(n: number): number {
  return byteLengthOf(new ArrayBuffer(16 + (n - n)));
}

// Held only, never read through: the four-member union is representable as a
// parameter, which is the whole of what the 81 sites needed.
function accepts(
  b: ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined,
): boolean {
  return b === undefined;
}

export function absentIsAbsent(n: number): boolean {
  return accepts(undefined) && n === n;
}

export function presentIsPresent(n: number): boolean {
  return !accepts(new ArrayBuffer(2 + (n - n)));
}

export function aViewIsPresent(n: number): boolean {
  return !accepts(new Uint8Array(3 + (n - n)));
}

// The identity the constructor refusal protects: every value that can reach
// this representation really is an `ArrayBuffer`, so this stays true.
export function isAnArrayBuffer(n: number): boolean {
  const b: ArrayBuffer | SharedArrayBuffer = new ArrayBuffer(1 + (n - n));
  return b instanceof ArrayBuffer;
}
