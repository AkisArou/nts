// A class's parameter properties are its first fields: TypeScript emits
// `constructor(public x: number)` as a field declared before every field the
// class body writes, so `Object.keys(new Point(1, 2))` is `x,y,label` although
// `label` is written first. The layout took the checker's source order and
// answered `label,x,y`. `Plain` is the control, with no parameter
// properties; `Point3` adds a derived class's own field after its base's.

class Point {
  label = "p";
  constructor(
    public x: number,
    public y: number,
  ) {}
}

class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}

class Mixed {
  first = 1;
  constructor(
    public b: number,
    readonly a: number,
  ) {}
  last = 2;
}

class Plain {
  label = "p";
  x = 0;
  y = 0;
}

function code(keys: string[]): number {
  let h = 7;
  for (const key of keys) {
    for (let i = 0; i < key.length; i++) {
      h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    }
    h = (Math.imul(h, 31) + 44) | 0;
  }
  return h;
}

export function point(seed: number): number {
  const p = new Point(seed, seed + 1);
  return code(Object.keys(p)) + p.x;
}

export function derived(seed: number): number {
  return code(Object.keys(new Point3(seed, 2, 3)));
}

export function mixed(seed: number): number {
  const m = new Mixed(seed, 2);
  return code(Object.keys(m)) + m.b * 3 + m.a;
}

export function plain(seed: number): number {
  const p = new Plain();
  p.x = seed;
  return code(Object.keys(p)) + p.x;
}

console.log(Object.keys(new Point(1, 2)).join(","));
console.log(Object.keys(new Point3(1, 2, 3)).join(","));
console.log(Object.keys(new Mixed(1, 2)).join(","));
console.log(Object.keys(new Plain()).join(","));
