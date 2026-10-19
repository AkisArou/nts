/*---
description: An interface property is implemented by a getter in one class and a field in another.
features: [ts-interfaces, ts-accessors, ts-class]
---*/
interface Sized {
  readonly size: number;
}
class Fixed implements Sized {
  readonly size = 4;
}
class Computed implements Sized {
  constructor(private items: string[]) {}
  get size(): number {
    return this.items.length;
  }
}
const all: Sized[] = [new Fixed(), new Computed(["a", "b"]), { size: 7 }];
assert.sameValue(all.map((s) => s.size).join(","), "4,2,7");
