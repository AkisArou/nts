// expect: NTS1001 `byteLength` on a union one of whose members has no layout
//
// The four-member union the corpus writes now lowers **as a parameter** --- that
// is what representing `SharedArrayBuffer` bought, 81 sites --- and reading a
// member through it is the next obstacle:
//
//     ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined
//
// `ArrayBufferView` has no layout. `ArrayBuffer` and `SharedArrayBuffer` both
// represent as `ManagedType::Buffer` and a `Uint8Array` represents as a view,
// so the union has three members and two representations, and a member read
// needs one layout to read through.
//
// The two-member form works and is asserted in
// `examples/a-shared-array-buffer-in-a-union`:
//
//     function byteLengthOf(b: ArrayBuffer | SharedArrayBuffer): number {
//       return b.byteLength;                              // lowers
//     }
//
// **Written as a parameter, deliberately.** A first draft said
// `const b: <the union> = new ArrayBuffer(4)`, and the checker narrows a local
// to its initializer's type, so the read was an `ArrayBuffer` read and the
// fixture reported itself FIXED. A parameter is the only spelling that keeps
// the union opaque at the read.
//
// So this is a question about `ArrayBufferView`, the interface every typed
// array and `DataView` satisfies structurally, and not about shared buffers.
// It is the same shape as `an-iterable-behind-an-interface`: a lib interface
// nothing declares `implements`, so there is no edge to number a dispatch slot
// against and no layout to read a field through.

function sizeOrZero(
  b: ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined,
): number {
  return b === undefined ? 0 : b.byteLength;
}

export function measured(n: number): number {
  return sizeOrZero(new ArrayBuffer(4 + (n - n)));
}
