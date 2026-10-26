// Private and symbol identities remain exact through member reads. The
// public control differs only in which namespace holds the same value.
const key: unique symbol = Symbol("key");
class PrivateOwner {
  #value: number;
  value: number;
  constructor(n: number) { this.#value = n; this.value = n; }
  static cast(value: unknown): number { return (value as PrivateOwner).#value; }
  static castControl(value: unknown): number { return (value as PrivateOwner).value; }
  static union(value: PrivateOwner | PrivateChild): number { return value.#value; }
  static unionControl(value: PrivateOwner | PrivateChild): number { return value.value; }
}
class PrivateChild extends PrivateOwner { extra = 1; }
interface Keyed { [key]: number; }
class KeyedOwner {
  [key]: number = 0;
  value: number;
  constructor(n: number) { this[key] = n; this.value = n; }
}
function castKeyed(value: unknown): number { return (value as Keyed)[key]; }
function castNamed(value: unknown): number { return (value as { value: number }).value; }
class Bytes extends Uint8Array {
  #read(n: number): number { return n + 1; }
  publicRead(n: number): number { return n + 1; }
  readPrivate(n: number): number { return this.#read(n); }
  readPublic(n: number): number { return this.publicRead(n); }
}
class Maybe {
  constructor(private n: number) {}
  get #value(): number | undefined { return this.n < 0 ? undefined : this.n; }
  get value(): number | undefined { return this.n < 0 ? undefined : this.n; }
  read(): number { if (this.#value !== undefined) return this.#value; return -1; }
  readControl(): number { if (this.value !== undefined) return this.value; return -1; }
}
export function erasedPrivate(n: number): number { return PrivateOwner.cast(new PrivateOwner(n)); }
export function erasedPublic(n: number): number { return PrivateOwner.castControl(new PrivateOwner(n)); }
export function sharedPrivate(n: number): number {
  return PrivateOwner.union(n < 0 ? new PrivateOwner(n) : new PrivateChild(n));
}
export function sharedPublic(n: number): number {
  return PrivateOwner.unionControl(n < 0 ? new PrivateOwner(n) : new PrivateChild(n));
}
export function erasedSymbol(n: number): number { return castKeyed(new KeyedOwner(n)); }
export function erasedName(n: number): number { return castNamed(new KeyedOwner(n)); }
export function derivedPrivate(n: number): number { return new Bytes(2).readPrivate(n); }
export function derivedPublic(n: number): number { return new Bytes(2).readPublic(n); }
export function getterAbsence(n: number): number { return new Maybe(n).read(); }
export function getterControl(n: number): number { return new Maybe(n).readControl(); }
