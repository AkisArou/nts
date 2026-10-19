/*---
description: A generic interface hierarchy implemented by a class, an object literal and a subclass, read through the base interface.
features: [ts-interfaces, ts-interface-extends, ts-generics, ts-class, ts-structural-typing]
---*/
interface Container<T> {
  items(): T[];
}
interface Countable<T> extends Container<T> {
  count(): number;
}
class ListBox<T> implements Countable<T> {
  constructor(protected list: T[]) {}
  items(): T[] {
    return this.list;
  }
  count(): number {
    return this.list.length;
  }
}
class SortedBox extends ListBox<number> {
  override items(): number[] {
    return [...this.list].sort((a, b) => a - b);
  }
}
const literal: Countable<number> = { items: () => [9], count: () => 1 };
const boxes: Container<number>[] = [new ListBox([3, 1]), new SortedBox([3, 1, 2]), literal];
assert.sameValue(boxes.map((b) => b.items().join("")).join(","), "31,123,9");
