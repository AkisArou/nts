class Animal { legs(): number { return 4; } }
class Dog extends Animal {
  constructor(public tag: string) { super(); }
  legs(): number { return 3; }
}
interface Maker { make(x: string | null): Animal }
class Parent { make(x: string | undefined): Animal { return new Animal(); } }
class Child extends Parent {
  make(x: string | null | undefined): Dog {
    return new Dog(x === null ? "null" : x === undefined ? "undefined" : x);
  }
}
function tagOf(value: Animal): string { return value instanceof Dog ? value.tag : "animal"; }
function throughParent(parent: Parent, n: number): string { return tagOf(parent.make(n > 1 ? "s" : undefined)); }
function throughMaker(maker: Maker, n: number): string { return tagOf(maker.make(n > 1 ? "s" : null)); }
export function both(n: number): string {
  const child = new Child();
  return throughParent(child, n & 3) + "/" + throughMaker(child, n & 3);
}
