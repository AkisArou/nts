// An `any` parameter every caller hands an object, an array or a boolean takes
// that representation in a source copy, as a number or a string already did.
// The copy receives the same object, so identity and every mutation through it
// stay shared with the caller. A parameter stored somewhere stays erased.

class Point {
  constructor(public x: number, public y: number) {}
  norm(): number { return Math.abs(this.x) + Math.abs(this.y); }
  shift(by: number): void { this.x += by; }
}
class Point3 extends Point {
  constructor(x: number, y: number, public z: number) { super(x, y); }
  norm(): number { return super.norm() + Math.abs(this.z); }
}

function sum(p: any): number { return p.x + p.y; }
function measured(p: any): number { return p.norm(); }
function moved(p: any, by: number): number { p.shift(by); return p.x; }
function same(a: any, b: any): boolean { return a === b; }
function total(xs: any): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
}
function second(xs: any): number { return xs[1]; }
// Past the end: `undefined`, which every consumer here reads as NaN, as the
// copy's `ToNumber` does.
function pastTheEnd(xs: any): number {
  let s = 0;
  for (let i = 0; i <= xs.length; i++) s += xs[i];
  return s;
}
function signed(flag: any, n: number): number { return flag === true ? n : -n; }

let kept: any = null;
function keep(p: any): number { kept = p; return 1; }

export function fieldRead(n: number): number { return sum(new Point(n, n + 1)); }
export function methodCall(n: number): number { return measured(new Point(n, -n)); }
export function subclassInstance(n: number): number { return measured(new Point3(n, 1, -2)); }
export function sharedMutation(n: number): number {
  const p = new Point(n, 0);
  const after = moved(p, 3);
  return after === p.x ? p.x : -1;
}
export function identity(n: number): number {
  const p = new Point(n, n);
  return (same(p, p) ? 1 : 0) + (same(p, new Point(n, n)) ? 10 : 0);
}
export function arrayRead(n: number): number { return total([n, n * 2, 3]) + second([n, 5]); }
export function arrayPastTheEnd(n: number): number { return pastTheEnd([n, 1]) + second([n]); }
export function booleanFlag(n: number): number { return signed(true, n) + signed(false, n * 3); }
export function storedStaysErased(n: number): number {
  keep(new Point(n, 0));
  const answer = kept === null ? -1 : 2;
  // Given back, so a reference-counted run ends holding what it began with.
  kept = null;
  return answer;
}
