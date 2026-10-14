// run: check
//
// An object viewed as an interface whose fields its class orders otherwise,
// read through a generic's type argument, through an array a generic returns,
// and by destructuring. Each read must find the object's own field. Main
// refuses the `S1` -> `Face` view, so three of the four functions; Part 2
// stage B admits the view, and every route must dispatch.
interface Face { a: number; b: string }
class S1 { b = "x"; a = 1 }
class Q1 { a = 5; b = "q" }
function readA(f: Face): number { return f.a; }
function readB<T extends { b: string }>(p: T): string { return p.b; }
function first<T>(items: T[]): T { return items[0]; }
export function viaQ(n: number): number { return readA(new Q1()) + n; }
export function genericRead(n: number): string {
  const f: Face = new S1();
  readA(f);
  return readB(f);
}
export function genericHolder(n: number): string {
  const f: Face = new S1();
  return first([f]).b + readA(f);
}
export function destructured(n: number): string {
  const f: Face = new S1();
  const { b } = f;
  return b + readA(f);
}
