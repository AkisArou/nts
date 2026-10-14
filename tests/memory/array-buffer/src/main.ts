// An `ArrayBuffer` made and dropped, in a loop.
//
// The subject is the **second allocation**. A buffer is a struct and a
// separate block of bytes, and the separation is a decision rather than an
// accident: a view must not be invalidated by its buffer changing length, so
// the bytes cannot be a tail the way an array's elements are. That decision
// costs one allocation per buffer, forever, and this is where it is visible.
//
// It is also where the hazard of it is. The block is `calloc`'d and given back
// by `nts_free_storage`, which runs from `nts_free` -- and a buffer that
// escape analysis placed in the frame never reaches `nts_free` at all. Frame
// storage is right for a struct that owns nothing and wrong for one that owns
// a heap block, and the difference is invisible in every answer the program
// computes. The leak check is what would see it.
export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    const buffer = new ArrayBuffer(64);
    total = (total + buffer.byteLength) | 0;
  }
  return total;
}
