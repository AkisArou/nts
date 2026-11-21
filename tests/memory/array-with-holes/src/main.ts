// An array of references whose slots are not all objects: every other slot is
// null, and a second array holds string literals, which are immortal.
//
// Both die through the runtime's pointer-slot contents callback. A null slot
// is skipped before any release, as the generic walk skipped it, so it costs
// no counted operation; an immortal string is released and keeps its count.

class Cell {
  value: number;
  constructor(v: number) { this.value = v; }
}

export function work(n: number): number {
  const cells: (Cell | null)[] = [];
  for (let i = 0; i < 16 + n; i++) {
    cells.push((i & 1) === 0 ? new Cell(i) : null);
  }
  const words: string[] = ["north", "south", "east", "west"];
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell !== null) total = total + cell.value;
  }
  for (let i = 0; i < words.length; i++) {
    total = total + words[i].length;
  }
  return total;
}
