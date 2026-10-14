// Class tests that name structural types. A `function` whose `this:` is typed
// reads its receiver at that type's storage, after a test every object laid
// out there passes (`InstanceOf { by_layout }`): an instance of the class, a
// literal typed as it, and a class of the same shape that never names it. An
// `in` over a union of interfaces tests each type that declares the name.
// Each listed type is tested by the identity it carries: a class's, or its
// record shape's.

interface Valued {
  v: number;
}

class Box {
  constructor(public v: number) {}
}

class SameShape {
  constructor(public v: number) {}
}

export function interfaceThis(n: number): number {
  const read = function (this: Valued, k: number): number {
    return this.v * k;
  };
  return read.call({ v: n & 7 }, 1) * 100 + read.call(new Box(n & 3), 3) * 10 + read.call(new SameShape(1), 1);
}

export function classThis(n: number): number {
  const read = function (this: Box, k: number): number {
    return this.v + k;
  };
  const literal: Box = { v: n & 5 };
  return read.call(new Box(n & 3), 1) * 100 + read.call(literal, 2);
}

interface Circle {
  radius: number;
}

interface Square {
  side: number;
}

// `in` narrows a union of structural types by testing the value against
// every type that declares the name, each by its record shape's identity.
export function inNarrowing(n: number): number {
  const shape: Circle | Square = (n & 1) === 0 ? { radius: n & 7 } : { side: n & 3 };
  if ("radius" in shape) return shape.radius * 10;
  return shape.side;
}
