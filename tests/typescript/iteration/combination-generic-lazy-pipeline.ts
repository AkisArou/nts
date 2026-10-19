/*---
description: A generic lazy pipeline class wrapping any iterable, chaining generator stages over a union element type.
features: [ts-iteration, ts-generators, ts-generics, ts-class, ts-unions, ts-symbols]
---*/
class Lazy<T> implements Iterable<T> {
  constructor(private source: Iterable<T>) {}
  [Symbol.iterator](): Iterator<T> {
    return this.source[Symbol.iterator]();
  }
  map<U>(f: (item: T) => U): Lazy<U> {
    const source = this.source;
    return new Lazy({ *[Symbol.iterator]() { for (const item of source) yield f(item); } });
  }
  where(keep: (item: T) => boolean): Lazy<T> {
    const source = this.source;
    return new Lazy({ *[Symbol.iterator]() { for (const item of source) if (keep(item)) yield item; } });
  }
}
const mixed: Lazy<number | string> = new Lazy<number | string>([1, "two", 3, "four"]);
const lengths = mixed.map((item) => (typeof item === "number" ? item : item.length)).where((n) => n > 1);
assert.compareArray([...lengths], [3, 3, 4]);
assert.compareArray([...new Lazy(new Set(["a"])).map((s) => s + s)], ["aa"]);
