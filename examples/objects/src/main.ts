// A declared shape is a flat struct: fields at fixed offsets, `p.x` a load. The
// C compiler decides padding and alignment, because it is a real struct rather
// than manual offsets.
interface Point {
  x: number;
  y: number;
}

// TypeScript is structurally typed, so the anonymous `{ x, y }` of this literal
// and `Point` are the *same type* -- and get one layout, not two. Without that
// they would be two C structs of identical shape that could not be passed to
// each other.
function make(x: number, y: number): Point {
  return { x, y };
}

export function distanceSquared(x: number, y: number): number {
  const p = make(x, y);
  return p.x * p.x + p.y * p.y;
}

export function shifted(x: number, y: number, by: number): number {
  const p = make(x, y);
  p.x = p.x + by;
  p.y = p.y + by;
  return p.x * 1000 + p.y;
}

// Written out rather than shorthand, to pin that both spellings reach the same
// field of the same layout.
export function explicit(): number {
  const p: Point = { x: 3, y: 4 };
  return p.x * 10 + p.y;
}

// `readonly` is semantic, not syntactic -- `Readonly<T>` counts too -- and it
// becomes `const` on the field, which lets the C compiler hoist loads.
interface Frozen {
  readonly scale: number;
}

export function scaledBy(v: number): number {
  const f: Frozen = { scale: 7 };
  return v * f.scale;
}

// A reference field is a pointer. Under NoGC nothing is ever freed, so it costs
// neither a write barrier nor a trace -- but *which* fields are references is
// recorded on the layout as a pointer bitmap (RFC 8.3), because that is a fact
// about the layout and the collector that comes later cannot be told it after
// the fact.
interface Person {
  name: string;
  age: number;
}

export function describe(): number {
  const p: Person = { name: "ada", age: 36 };
  return p.name.length * 100 + p.age;
}

// An object holding an object. The forward declarations exist so a field can
// point at a type declared later, or at its own.
interface Team {
  lead: Person;
  size: number;
}

export function teamAge(): number {
  const t: Team = { lead: { name: "grace", age: 45 }, size: 3 };
  return t.lead.age * t.size + t.lead.name.length;
}

// An array whose elements are references.
export function totalAges(): number {
  const people: Person[] = [
    { name: "ada", age: 36 },
    { name: "grace", age: 45 },
  ];
  let total = 0;
  for (let i = 0; i < people.length; i++) {
    total += people[i]!.age;
  }
  return total;
}
