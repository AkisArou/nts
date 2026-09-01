// An object that never leaves the function that made it. It should cost no
// counting at all: escape analysis puts it in the frame, and a frame object
// has no count to change.

class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const p = new Point(i, i + n);
    total = total + p.x + p.y;
  }
  return total;
}
