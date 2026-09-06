/** A promise capability with no casts, definite-assignment assertions, or host hooks. */
export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolveValue: ((value: T | PromiseLike<T>) => void) | undefined;
  private rejectValue: ((reason: unknown) => void) | undefined;
  settled = false;
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveValue = resolve;
      this.rejectValue = reject;
    });
  }
  resolve(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveValue?.(value);
  }
  reject(reason: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectValue?.(reason);
  }
}
export function ignoreRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}
