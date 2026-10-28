// Control: only Receiver changes from interface View<T> to class Supplier<T>.
const key: unique symbol = Symbol("reader");
type Receiver<T> = Supplier<T>;
interface View<T> { readonly desiredSize: number | null; enqueue(value: T): void; }
class Supplier<T> {
  readonly padding = 13;
  readonly #value: number;
  readonly reader: Reader<T>;
  constructor(value: number) { this.#value = value; this.reader = new Reader(key, this); }
  get desiredSize(): number | null { return this.#value; }
  enqueue(_value: T): void {}
}
export class Reader<T> {
  readonly #value: Receiver<T>;
  constructor(...args: [typeof key, Receiver<T>]) {
    if (args[0] !== key || args[1] === undefined) throw new TypeError("Illegal constructor");
    this.#value = args[1];
  }
  read(): number | null { return this.#value.desiredSize; }
}
export function work(n: number): number { return new Supplier<number>(n).reader.read() ?? 0; }
