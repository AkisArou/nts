// expect: whose holes read as `undefined` where a null slot of it reads as `null`
// The generic source and nullable field must not hide the element's null-only
// absence. An unfilled allocation has holes, which read as undefined in JS.
// The control differs only by filling the new array immediately.
class Holder<T> {
  storage: (T | null)[] | null;
  constructor(size: number) {
    this.storage = size === 0 ? null : new Array(size);
  }
}

class FilledHolder<T> {
  storage: (T | null)[] | null;
  constructor(size: number) {
    this.storage = size === 0 ? null : new Array<T | null>(size).fill(null);
  }
}

export function holes(n: number): number {
  const h = new Holder<string>((n & 3) + 1);
  const value = h.storage![0];
  return value === undefined ? 1 : value === null ? 2 : 3;
}

export function filledControl(n: number): number {
  const h = new FilledHolder<string>((n & 3) + 1);
  const value = h.storage![0];
  return value === undefined ? 1 : value === null ? 2 : 3;
}
