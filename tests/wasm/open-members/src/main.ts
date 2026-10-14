// A member read through a slot several layouts reach: the core's
// SharedFieldGet (the arms agree where the member is) and OpenFieldGet (they
// do not). Wasm tests each arm's storage, nominally, and reads that arm's own
// index. Each case varies which arm arrives.

class Counter {
  weight = 1;
  label = "counter";
}

class Meter {
  weight = 2;
  unit = "m";
}

function weightOf(value: Counter | Meter): number {
  return value.weight;
}

/** Classes that agree where `weight` is, narrowed to an integer. */
export function sharedClassField(n: number): number {
  const value: Counter | Meter = (n & 1) === 0 ? new Counter() : new Meter();
  return weightOf(value) * 10 + (n & 3);
}

interface First {
  status: number;
  detail: string;
}

interface Second {
  reason: string;
  status: number;
  accepted: boolean;
}

function statusOf(value: First | Second): number {
  return value.status;
}

/** Object types that disagree where `status` is: index 0 and index 1. */
export function disagreeingIndex(n: number): number {
  const value: First | Second =
    (n & 1) === 0 ? { status: n, detail: "first" } : { reason: "second", status: -n, accepted: true };
  return statusOf(value);
}

class XY {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class YX {
  y: number;
  x: number;
  constructor(x: number, y: number) {
    this.y = y;
    this.x = x;
  }
}

function xOf(value: XY | YX): number {
  return value.x;
}

/** Two layouts of one shape, fields swapped: only a nominal test reads `x`. */
export function sameShapeSwapped(n: number): number {
  const value: XY | YX = (n & 1) === 0 ? new XY(n, -1) : new YX(n, -1);
  return xOf(value);
}

class Base {
  tag = 7;
  name = "base";
}

class Derived extends Base {
  extra = 9;
}

class Other {
  extra = 3;
  tag = 11;
}

function tagOf(value: Base | Other): number {
  return value.tag;
}

/** A subclass arriving at its base's arm keeps the base's index. */
export function subclassArm(n: number): number {
  const which = n & 3;
  const value: Base | Other = which === 0 ? new Base() : which === 1 ? new Derived() : new Other();
  return tagOf(value) * 100 + which;
}

interface Circle {
  kind: "circle";
  r: number;
}

interface Square {
  kind: "square";
  side: number;
}

interface Triangle {
  base: number;
  kind: "triangle";
}

type Shape = Circle | Square | Triangle;

function kindOf(shape: Shape): string {
  return shape.kind;
}

/** Three arms in one array, read in a loop. */
export function threeArms(n: number): string {
  const shapes: Shape[] = [
    { kind: "circle", r: n & 7 },
    { kind: "square", side: 2 },
    { base: 3, kind: "triangle" },
  ];
  let text = "";
  for (let i = 0; i < shapes.length; i++) {
    text += kindOf(shapes[(i + (n & 3)) % 3]!).charAt(0);
  }
  return text;
}

interface Built {
  size: number;
  label: string;
}

interface NeverBuilt {
  label: string;
  size: number;
}

function sizeOf(value: Built | NeverBuilt): number {
  return value.size;
}

/** An arm no value of this program ever has: still a layout the read tests. */
export function unallocatedArm(n: number): number {
  const value: Built = { size: n & 15, label: "built" };
  return sizeOf(value);
}
