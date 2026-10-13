// Objects as Map and Set keys compare by identity: two objects of one shape
// are two keys, and one object is one key however often it is looked up. Each
// object's identity hash is given out on first use and fixed after, through
// growth, and an erased key that is an object or a function hashes the same.
class Point {
  x = 0;
  constructor(x: number) {
    this.x = x;
  }
}

export function sameShapeIsTwoKeys(n: number): number {
  const a = new Point(n);
  const b = new Point(n);
  const m = new Map<Point, number>();
  m.set(a, 1);
  m.set(b, 2);
  m.set(a, 3);
  return m.size * 100 + (m.get(a) ?? 0) * 10 + (m.get(b) ?? 0);
}

export function manyObjectsThroughGrowth(n: number): number {
  const points: Point[] = [];
  const s = new Set<Point>();
  for (let i = 0; i < 100 + (n & 3) * 40; i++) {
    const p = new Point(i);
    points.push(p);
    s.add(p);
  }
  let found = 0;
  for (const p of points) if (s.has(p)) found++;
  for (let i = 0; i < points.length; i += 2) s.delete(points[i]);
  return found * 1000 + s.size + (s.has(new Point(1)) ? 100000 : 0);
}

export function erasedObjectsAndFunctions(n: number): number {
  const p = new Point(n);
  const f = (x: number): number => x + n;
  const m = new Map<unknown, number>();
  m.set(p, 1);
  m.set(f, 2);
  m.set("p", 3);
  m.set(p, 4);
  return m.size * 100 + (m.get(p) ?? 0) * 10 + (m.get(f) ?? 0) + (m.has(new Point(n)) ? 1000 : 0);
}

export function arraysAsKeys(n: number): number {
  const a = [n];
  const b = [n];
  const s = new Set<number[]>([a, b, a]);
  return s.size * 10 + (s.has(a) ? 1 : 0);
}
