// Control: bypass the typeof-bounded generic call.
class Box {
  static s(n: number): number { return n + 1; }
}
class Other extends Box {
  static override s(n: number): number { return n + 10; }
}
class Plain {
  static s(n: number): number { return n + 20; }
}
function mk<T extends typeof Box>(c: T, n: number): number { return c.s(n); }
export function derived(n: number): number { return Other.s(n & 7); }
export function structural(n: number): number { return Plain.s(n & 7); }
