// `(h + 1) | 0` wraps at 2^31 - 1, and the comparison after it sees the wrap.
//
// Specialization types `h` as an `i32` and `narrow::narrow_truncated` computes
// the `+ 1` at 32 bits, because `add`, `sub` and `mul` are congruent modulo
// 2^32 and the `| 0` truncates. That arithmetic is meant to wrap. The LLVM
// backend spelled every signed `i32` add, sub and mul `nsw`, a promise that it
// never wraps, and clang kept the promise: `icmp sgt (add nsw h, 1), h` folded
// to `true`.
//
//     wrapsPastMax(0)   node 9    C 9    LLVM 10   (before the fix)
//
// The C backend wraps through `uint32_t` and always agreed. `staysBelowMax` is
// the control: the same loop started where no add can wrap, which agrees on
// every backend, so the wrap is what broke it. Found by the numbers study.

export function wrapsPastMax(seed: number): number {
  let h = (2147483640 + (seed & 1)) | 0;
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const m = (h + 1) | 0;
    if (m > h) {
      count = count + 1;
    }
    h = m;
  }
  return count;
}

export function staysBelowMax(seed: number): number {
  let h = (5 + (seed & 1)) | 0;
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const m = (h + 1) | 0;
    if (m > h) {
      count = count + 1;
    }
    h = m;
  }
  return count;
}
