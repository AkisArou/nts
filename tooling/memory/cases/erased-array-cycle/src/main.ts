// A cycle through an array of erased elements: Box -> items (unknown[]) -> Box.
//
// The array's element type is erased, and an array of erased values is never a
// candidate on its own account, so the only member that can be offered to the
// collector is the box -- which reachability called acyclic while an erased
// element led nowhere.

class Box {
  items: unknown[] = [];
  value = 1;
}

function add(b: Box, x: unknown): void {
  b.items.push(x);
}

export function work(count: number): number {
  let made = 0;
  for (let i = 0; i < 4 + count; i = i + 1) {
    const b = new Box();
    add(b, b);
    made = made + b.value;
  }
  return made;
}
