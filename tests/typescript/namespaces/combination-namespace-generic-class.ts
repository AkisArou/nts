/*---
description: A function merged with a namespace that exports a generic class implementing its own interface.
features: [ts-namespace, ts-generics, ts-class, ts-interfaces, ts-declaration-merging]
---*/
function Store(n: number): Store.Reader<number> {
  return new Store.Cell(n);
}
namespace Store {
  export interface Reader<T> {
    read(): T;
  }
  export class Cell<T> implements Reader<T> {
    constructor(private value: T) {}
    read(): T {
      return this.value;
    }
  }
}
assert.sameValue(Store(7).read(), 7);
const text: Store.Reader<string> = new Store.Cell("t");
assert.sameValue(text.read(), "t");
