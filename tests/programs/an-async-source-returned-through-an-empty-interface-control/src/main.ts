// Isolated control for an-async-source-returned-through-an-empty-interface.
// The control factory returns its concrete class, so no value is stored
// through the nominal representation of the fieldless interface.
// The two factories differ only in their return contract. Both allocate the
// same source. The interface has no represented fields or callable slots.
// An unrelated empty base with a subclass keeps the shared layout nominal.
class EventTargetLike {}
class Child extends EventTargetLike { marker = 7; }
export const empty: unknown = new Child();
interface StreamAbortSignal { aborted: boolean; reason?: unknown; }
class AbortableAsyncSource<T> implements AsyncIterable<T> {
  readonly #source: AsyncIterable<T>;
  readonly #signal: StreamAbortSignal;
  constructor(source: AsyncIterable<T>, signal: StreamAbortSignal) {
    this.#source = source;
    this.#signal = signal;
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {}
}
function throughInterface<T>(source: AsyncIterable<T>, signal: StreamAbortSignal): AsyncIterable<T> {
  return new AbortableAsyncSource(source, signal);
}
function throughClass<T>(source: AsyncIterable<T>, signal: StreamAbortSignal): AbortableAsyncSource<T> {
  return new AbortableAsyncSource(source, signal);
}
class Signal implements StreamAbortSignal {
  aborted = false;
  reason: unknown = undefined;
}
function input(): AsyncIterable<number> {
  return { async *[Symbol.asyncIterator]() { yield 1; } };
}
export function control(n: number): number {
  const source = input();
  const result = throughClass(source, new Signal());
  return n + ((result as unknown) === (source as unknown) ? 1 : 2);
}
