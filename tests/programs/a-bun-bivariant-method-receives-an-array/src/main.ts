// Control: only the adversarial undefined argument becomes an empty array.
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
  return hh.h(n === 1 ? [] : [1, 2]);
}
