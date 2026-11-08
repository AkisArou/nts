// Control for an-iterable-intersection-kept-in-a-nullable-field.
// Only the source type changes; allocation and private-field access are identical.
interface Hooks { destroy?: (() => unknown) | undefined; return?: (() => unknown) | undefined; [Symbol.asyncDispose]?: (() => PromiseLike<void>) | undefined; }
interface AsyncSource extends AsyncIterable<unknown>, Hooks {}
interface SyncSource extends Iterable<unknown>, Hooks {}
type Source = AsyncSource | SyncSource;
class Holder { #source: Source | null; constructor(source: Source | null) { this.#source=source; } present(): number { return this.#source === null ? 0 : 1; } }
export function present(n: number): number { return new Holder([n]).present(); }
