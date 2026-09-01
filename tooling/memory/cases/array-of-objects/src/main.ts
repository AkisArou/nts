// Elements that are references, which is the array descriptor's cyclic case:
// one descriptor serves every array, so it says nothing about what the elements
// point at and the collector has to assume the worst.
//
// Every push is a move -- the cell is built into the argument and dies there --
// and every read in the second loop is a borrow, because nothing between the
// load and the use can shorten the array.

class Cell {
  value: number;
  constructor(v: number) { this.value = v; }
}

export function work(n: number): number {
  const cells: Cell[] = [];
  for (let i = 0; i < 16 + n; i++) {
    cells.push(new Cell(i));
  }
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    total = total + cells[i].value;
  }
  return total;
}
