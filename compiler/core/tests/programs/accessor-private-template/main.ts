interface OptionalFlag { readonly flag?: boolean; }
class Computed { get flag(): boolean { return true; } }
export function readFlag(value: OptionalFlag): unknown { return value.flag; }
export function makeComputed(): unknown { return new Computed(); }

class Stream<T> {
  #value: T;
  constructor(value: T) { this.#value = value; }
  value(): T { return this.#value; }
  release(reader: Reader<T>): T { return reader.value(); }
}
class Reader<T> {
  #stream: Stream<T>;
  constructor(stream: Stream<T>) { this.#stream = stream; }
  value(): T { return this.#stream.value(); }
}
class Iterator<T> {
  #stream: Stream<T> | null;
  #reader: Reader<T> | null;
  constructor(stream: Stream<T>) {
    this.#stream = stream;
    this.#reader = new Reader(stream);
  }
  release(): T | undefined {
    const stream = this.#stream;
    const reader = this.#reader;
    if (stream !== null && reader !== null) return stream.release(reader);
    return undefined;
  }
}
export function observeNumber(value: number): number | undefined {
  return new Iterator(new Stream(value)).release();
}
