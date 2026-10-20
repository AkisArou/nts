// A derived class's parameter property over a field its base initialises.
// JavaScript assigns a parameter property after `super()` returns and after
// the class's own field initialisers, so the derived value wins and the base
// constructor sees its own. nts stored it at the top of the constructor --
// before `super()` -- and the base's initialiser then overwrote it:
// `new Polygon(5).sides` answered 0.
//
// `distinct` is the control: a parameter property whose name the base does
// not have, which agreed.

class Shape {
  sides = 0;
  seenByBase: number;
  constructor() {
    this.seenByBase = this.sides;
  }
}

class Polygon extends Shape {
  constructor(override readonly sides: number) {
    super();
  }
}

class Labelled {
  label = "base";
}

class Named extends Labelled {
  constructor(public label: string) {
    super();
  }
}

class Plain extends Shape {
  constructor(public extra: number) {
    super();
  }
}

export function overriding(n: number): number {
  const polygon = new Polygon(n & 7);
  return polygon.sides * 100 + polygon.seenByBase;
}

export function named(n: number): string {
  return new Named(`n${n & 3}`).label;
}

export function distinct(n: number): number {
  const plain = new Plain(n & 7);
  return plain.extra * 100 + plain.sides + plain.seenByBase;
}
