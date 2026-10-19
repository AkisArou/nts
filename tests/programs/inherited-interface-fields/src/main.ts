// An interface inheriting fields, held by a class that extends something
// else.
//
// `WithParent extends Parent` carries `x` by inheritance and adds `y`.
// `Holder` implements it while extending the unrelated `Padding`, so no
// backend can spell the holder's fields through the face's own storage:
// C reads them by position, and the JVM needs a companion interface per
// face, the child's extending the parent's along the declared chain.
// The flat control is the same program with the `extends` removed, which
// every backend already answered. Diamond and generic arms follow, then
// a write through the parent read back through the child.

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

interface Flat {
  x: number;
  y: number;
  describe(): number;
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

export function throughParent(n: number): number {
  const v: Parent = new Holder(n | 0);
  return v.x + v.describe();
}

export function throughChild(n: number): number {
  const v: WithParent = new Holder(n | 0);
  return v.x * 100 + v.y;
}

export function throughGrandchild(n: number): number {
  const v: Middle = new Holder(n | 0);
  return v.x * 10000 + v.y * 100 + v.z;
}

export function flatControl(n: number): number {
  const v: Flat = new Holder(n | 0);
  return v.x * 100 + v.y + v.describe();
}

export function writtenThroughParent(n: number): number {
  const holder = new Holder(n | 0);
  const parent: Parent = holder;
  parent.x = (n | 0) + 40;
  const child: WithParent = holder;
  return child.x * 100 + child.y;
}

export function diamond(n: number): number {
  const gem = new Gem(n | 0);
  const left: DiamondLeft = gem;
  const right: DiamondRight = gem;
  const whole: Diamond = gem;
  return left.a * 1000 + right.r * 100 + whole.l * 10 + whole.w;
}

export function genericBoxes(n: number): string {
  const nums: NumBox = new NumHolder(n | 0);
  const strs: StrBox = new StrHolder("s" + (n | 0));
  return nums.v + "," + nums.extra + "," + strs.v + "," + strs.extra;
}
