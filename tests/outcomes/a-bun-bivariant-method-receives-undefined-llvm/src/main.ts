// run: check
// backend: llvm
// A2: Bun's method-bivariance route, adapted to a scalar differential entry.
// Source: bun 3a9ea00437f8065cd5a4604d7423299a769e2d9e,
// test/aot/parallel/mistyped-values/method-bivariance.ts (MIT).
// Control changes only the undefined argument to an empty array.
export function work(n: number): number {
  interface H {
    h(x: number[] | undefined): number;
  }
  class I implements H {
    h(x: number[]): number {
      try {
        return x.length;
      } catch {
        return -1;
      }
    }
  }
  const hh: H = new I();
  return hh.h(n === 1 ? undefined : [1, 2]);
}
