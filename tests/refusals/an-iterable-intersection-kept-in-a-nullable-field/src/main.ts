// expect: a property `#source` of unrepresentable type (a union of an intersection | null)
// Reduced from runtime/node/zlib/src/zip/entry.ts and types.ts.
interface Hooks { destroy?: (() => unknown) | undefined; return?: (() => unknown) | undefined; [Symbol.asyncDispose]?: (() => PromiseLike<void>) | undefined; }
type Source = (AsyncIterable<unknown> | Iterable<unknown>) & Hooks;
class Holder { #source: Source | null; constructor(source: Source | null) { this.#source=source; } present(): number { return this.#source === null ? 0 : 1; } }
export function present(n: number): number { return new Holder([n]).present(); }
