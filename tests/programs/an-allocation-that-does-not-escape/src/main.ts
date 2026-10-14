// A fixture for asserting that frame placement **did something**.
//
// An object that outlives nothing can live in the caller's frame instead of the
// heap. A compiler that stopped doing it would emit a correct program that
// allocates on every call — and every correctness test in the repository would
// go on passing, which is the shape a dead cache had here on the same day.
//
// The observable is in the prepared HIR: `object.new frame` against
// `object.new heap`. The second arm is what makes the first mean something —
// a pass that framed *everything* would be wrong, and would pass an assertion
// that only looked at `stays`.

class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

// Already holding an object before the first case runs. `rc.sh` measures what
// is live after the first case and again at the end and calls the growth a
// leak, which it cannot distinguish from state the program still needs — so an
// escape target that *accumulates* reads as 58 objects never given back. A slot
// that is overwritten keeps the escape and keeps the live set constant.
let kept: Point = new Point(0, 0);

/** Nothing outlives the call, so the allocation belongs in the frame. */
export function stays(n: number): number {
  const p = new Point(n, n + 1);
  return p.x + p.y;
}

/** Escapes into a module-level slot, so it must stay on the heap. Returns a
 *  number rather than the object so the differential can compare it. */
export function escapesToAGlobal(n: number): number {
  const p = new Point(n, n + 1);
  kept = p;
  return p.x;
}

function make(n: number): Point {
  return new Point(n, n * 2);
}

/** Returned from a callee and *still* framed, because `make` is inlined first.
 *  Here to record that the placement is decided after inlining rather than at
 *  the syntactic boundary — it reads like an escape and is not one. */
export function escapesByReturn(n: number): number {
  const p = make(n);
  return p.y;
}

/** Two allocations in one function, one of each kind. */
export function bothInOne(n: number): number {
  const a = new Point(n, 1);
  const b = new Point(n, 2);
  kept = b;
  return a.x + a.y + b.y;
}
