// Replacement objects and growing copied arrays. Earlier states do not
// escape; this is the unique-owner reuse opportunity, without an annotation.
export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  for (let batch = 0; batch < 4 * n; batch++) {
    let state = { k: batch | 0, a: 7, b: 11, c: 13 };
    let xs: number[] = [];
    for (let i = 0; i < 256; i++) {
      state = { ...state, k: (state.k + i + 1) | 0 };
      xs = [...xs, state.k];
      total = (total + state.a + state.b + state.c + xs[(i * 17) % xs.length]!) | 0;
    }
    total = (total + xs.length + state.k) | 0;
  }
  return total;
}

export const seed = 0;
