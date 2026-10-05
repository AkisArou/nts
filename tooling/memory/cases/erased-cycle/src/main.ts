// A cycle through a field that can hold anything: Box -> data (unknown) -> Box.
//
// Reachability had no arm for an erased type, so a field of one led nowhere,
// `Box` was classified acyclic, and no box was ever offered to the collector.

class Box {
  data: unknown = null;
  value = 1;
}

function link(b: Box): void {
  b.data = b;
}

export function work(count: number): number {
  let made = 0;
  for (let i = 0; i < 4 + count; i = i + 1) {
    const b = new Box();
    link(b);
    made = made + b.value;
  }
  return made;
}
