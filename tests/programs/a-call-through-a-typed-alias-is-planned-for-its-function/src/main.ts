// A call through a `const` that holds a function is planned for that
// function, not for the annotation the checker resolved it to.
//
// `const boxIdentity: (value: Box) => Box = identity` resolves
// `boxIdentity(box)` to the annotation, a signature with no body. Structural
// copying planned a copy of it for a `Child` argument -- `identity@0obj6`,
// which nothing builds -- and that suffix replaced the generic instantiation
// the call needed: "nothing in this program defines" it. Planned for
// `identity` itself, a generic function, the call keeps its instantiation;
// and a plain function behind such an alias gets the copy the argument
// needs, here an array where a record is declared.

function identity<T>(value: T): T { return value; }
class Box { constructor(public value: number) {} }
class Child extends Box {}
const boxIdentity: (value: Box) => Box = identity;
export function nominalValue(n: number): boolean {
  const box = new Child(n);
  const result = boxIdentity(box);
  return result === box && result.value === n;
}

function measure(shape: { readonly length: number }): number { return shape.length * 10; }
const measured: (shape: { readonly length: number }) => number = measure;
export function arrayAsRecord(n: number): number {
  const items = [n, n + 1, n + 2];
  return measured(items) + measured({ length: n });
}
