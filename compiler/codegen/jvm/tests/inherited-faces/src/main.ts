interface Parent {
  x: number;
  describe(): number;
}
interface WithParent extends Parent {
  y: number;
}
interface Middle extends WithParent {
  z: number;
}

class Padding {
  padding = 901;
}

class Holder extends Padding implements Middle {
  z: number;
  y: number;
  x: number;
  constructor(n: number) {
    super();
    this.z = n + 2;
    this.y = n + 1;
    this.x = n;
  }
  describe(): number {
    return this.x * 10;
  }
}

interface DiamondRoot {
  a: number;
}
interface DiamondLeft extends DiamondRoot {
  l: number;
}
interface DiamondRight extends DiamondRoot {
  r: number;
}
interface Diamond extends DiamondLeft, DiamondRight {
  w: number;
}

class Gem extends Padding implements Diamond {
  w: number;
  r: number;
  l: number;
  a: number;
  constructor(n: number) {
    super();
    this.w = n + 3;
    this.r = n + 2;
    this.l = n + 1;
    this.a = n;
  }
}

interface Box<T> {
  v: T;
}
interface NumBox extends Box<number> {
  extra: number;
}
interface StrBox extends Box<string> {
  extra: string;
}

class NumHolder extends Padding implements NumBox {
  extra: number;
  v: number;
  constructor(n: number) {
    super();
    this.extra = n + 1;
    this.v = n;
  }
}

class StrHolder extends Padding implements StrBox {
  extra: string;
  v: string;
  constructor(s: string) {
    super();
    this.extra = s + "!";
    this.v = s;
  }
}

class ConcreteBase {
  b: number = 1;
}
interface ChildOfClass extends ConcreteBase {
  y: number;
}

export function throughChain(n: number): number {
  const whole: Middle = new Holder(n | 0);
  const parent: Parent = whole;
  parent.x = (n | 0) + 40;
  return whole.x * 10000 + whole.y * 100 + whole.z + whole.describe();
}

export function diamond(n: number): number {
  const whole: Diamond = new Gem(n | 0);
  return whole.a * 1000 + whole.l * 100 + whole.r * 10 + whole.w;
}

export function genericBoxes(n: number): string {
  const nums: NumBox = new NumHolder(n | 0);
  const strs: StrBox = new StrHolder("s" + (n | 0));
  return nums.v + "," + nums.extra + "," + strs.v + "," + strs.extra;
}

export function concreteParent(n: number): number {
  const value: ChildOfClass = { b: n | 0, y: (n | 0) + 1 };
  return value.y;
}
