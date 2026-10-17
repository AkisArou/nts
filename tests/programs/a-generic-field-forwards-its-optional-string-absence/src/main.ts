// The method copy knows T is string | undefined. Its argument erasure
// must use that source binding, not the unspecialized snapshot name T.
// The one-change control substitutes a present string for undefined.
class Holder<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  read(callback: (value: T) => number): number { return callback(this.value); }
}
function target(value: string = "missing"): number { return value.length; }
export function subject(n: number): number {
  const value: string | undefined = n < 0 ? undefined : "abc";
  return new Holder<string | undefined>(value).read(target);
}
export function control(n: number): number {
  const value: string | undefined = n < 0 ? "abc" : "abc";
  return new Holder<string | undefined>(value).read(target);
}
