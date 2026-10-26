// Public, private and symbol keys share a layout but never share identity.
const memberKey: unique symbol = Symbol("key");
class MixedKeys {
  x: number;
  #x: number;
  [memberKey]: number = 0;
  // This is the C escape of the private key's typed storage spelling p:#x.
  p_u003a__u0023_x: number;
  constructor(n: number) {
    this.x = n + 1;
    this.#x = n + 2;
    this[memberKey] = n + 3;
    this.p_u003a__u0023_x = n + 4;
  }
  read(): number {
    return this.x + 10 * this.#x + 100 * this[memberKey] + 1000 * this.p_u003a__u0023_x;
  }
}

// Control: only the public collision spelling changes.
class ControlKeys {
  x: number;
  #x: number;
  [memberKey]: number = 0;
  ordinary: number;
  constructor(n: number) {
    this.x = n + 1;
    this.#x = n + 2;
    this[memberKey] = n + 3;
    this.ordinary = n + 4;
  }
  read(): number {
    return this.x + 10 * this.#x + 100 * this[memberKey] + 1000 * this.ordinary;
  }
}
export function collision(n: number): number { return new MixedKeys(n).read(); }
export function control(n: number): number { return new ControlKeys(n).read(); }
