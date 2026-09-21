// expect: NTS1001 `new SharedArrayBuffer`
//
// The arm that protects an identity, and it is refused **on purpose**.
//
// `SharedArrayBuffer` represents as `ManagedType::Buffer`, the same as
// `ArrayBuffer` --- which is what lets the
// `ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined` unions the
// corpus writes lower at all, 81 refusal sites in `runtime/node`.
//
// Sharing a representation is not sharing an identity: `instanceof` is a
// descriptor check at run time, so two types with one layout can still be told
// apart, which is how `Map` and `Set` share a struct. But there is no
// descriptor for a shared buffer yet, and `lower_new_provided` dispatches on
// the *representation*, so a constructed one carried `ArrayBuffer`'s
// descriptor and
//
//     const s = new SharedArrayBuffer(8);
//     s instanceof ArrayBuffer          // node: false, this compiler: true
//
// answered wrongly. Measured, not reasoned about --- the probe came back
// `DISAGREE node=0 nts=1`. A wrong answer where this had been a missing one.
//
// So the constructor refuses at the **name**, which is the last point where the
// difference still exists; one line on, the program is a `Buffer`. Two sites in
// `runtime/node` pay for it, and both refused before the representation landed
// as well, so nothing that used to compile stopped.
//
// Lifting it means a descriptor of its own, after which `new` and `instanceof`
// both work rather than both refusing. Until then, with no way to construct
// one, every value a compiled program holds at that representation really is an
// `ArrayBuffer` --- which `examples/a-shared-array-buffer-in-a-union` asserts.

export function madeShared(n: number): number {
  const s = new SharedArrayBuffer(8 + (n - n));
  return s.byteLength;
}
