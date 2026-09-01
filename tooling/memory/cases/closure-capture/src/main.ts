// A closure is an object, and it owns what it captured.
//
// `box` is used *only* through the closure, so the frame's reference can move
// into the capture rather than be duplicated. Whether that happens is the whole
// question: a closure that retains what it captures pays twice for every
// object that was already dying.

class Box {
  value: number;
  constructor(v: number) { this.value = v; }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const box = new Box(i);
    const read = () => box.value;
    total = total + read();
  }
  return total;
}
