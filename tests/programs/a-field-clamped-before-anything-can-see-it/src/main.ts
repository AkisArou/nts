// A field stored out of its range and clamped before anything can see it.
//
// `Ball` in Are We Fast Yet moves with `this.x += this.xVel` and then clamps
// `x` to the box. A field's fact was the join of every store into it, and that
// store reads the field: its bound is its own bound plus a step, which has none
// once the whole-program fixpoint widens it (record 0357), so `Ball` became
// four doubles. What a read can find in a field is what was there where
// control could leave the code that wrote it -- a call, a return, a read
// through another reference -- and the unclamped value is never there.
// `Clamped.x` is an integer again; its storage still holds every store,
// transients included, and they fit.
//
// The control, `Peeked`, makes one call between the store and the clamp. The
// callee can see the unclamped value, that value feeds the next store, and the
// field keeps its double: a narrowing that ignored the call would be wrong in
// the same quiet way the round cap was.
//
// expect-ir: all: field Clamped.x is integer
// expect-ir: all: field Peeked.at is float

class Clamped {
  x = 0;
  step = 0;

  constructor(step: number) {
    this.step = step;
  }

  move(): void {
    this.x = this.x + this.step;
    if (this.x > 500) {
      this.x = 500;
    }
    if (this.x < 0) {
      this.x = 0;
    }
  }
}

let seen = 0;

function peek(at: number): void {
  seen = seen + at;
}

class Peeked {
  at = 0;
  by = 0;

  constructor(by: number) {
    this.by = by;
  }

  move(): void {
    this.at = this.at + this.by;
    peek(this.at);
    if (this.at > 500) {
      this.at = 500;
    }
    if (this.at < 0) {
      this.at = 0;
    }
  }
}

export function clamped(n: number): number {
  const ball = new Clamped((n & 255) - 128);
  let sum = 0;
  for (let i = 0; i < 40; i = i + 1) {
    ball.move();
    sum = sum + ball.x;
  }
  return sum;
}

export function peeked(n: number): number {
  seen = 0;
  const ball = new Peeked((n & 255) - 128);
  let sum = 0;
  for (let i = 0; i < 40; i = i + 1) {
    ball.move();
    sum = sum + ball.at;
  }
  return sum + seen;
}
