// The control changes only the selected method's return contract: the same
// Cursor<T> is returned through its concrete class or the carried library
// interface. The interface's T belongs to Source, not to a generic method.
// This pins the capture mechanism behind ReadableStream<T>.values; the small
// subject was also refused by the old Go compiler. The same-root runtime
// module's lost methods, rather than this reduction, establish the regression.
class Cursor<T> implements AsyncIterableIterator<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  next(): Promise<{ done: boolean; value: T; detail: { entries: (T | undefined)[] } }> {
    return Promise.resolve({ done: false, value: this.value, detail: { entries: [this.value] } });
  }
  [Symbol.asyncIterator](): Cursor<T> { return this; }
}

class Source<T> {
  value: T;
  calls = 0;
  constructor(value: T) { this.value = value; }
  values(): AsyncIterableIterator<T> { this.calls++; return new Cursor<T>(this.value); }
  direct(): Cursor<T> { this.calls++; return new Cursor<T>(this.value); }
}

export function subject(n: number): number {
  const source = new Source(n);
  source.values();
  return source.calls * 7 + n;
}

export function control(n: number): number {
  const source = new Source(n);
  source.direct();
  return source.calls * 7 + n;
}

// The written Flatten<T> alias is itself a syntax demand. An unused library
// return must still leave PromiseLike's member graph shallow. The frontend's
// isolated worker guard covers a return demanded only by a generic signature.
type Flatten<T> = T extends readonly (infer U)[] ? Flatten<U> : T;
declare function unusedRecursive<T>(): Flatten<T>;
declare function unusedLibrary<T>(): PromiseLike<T>;
