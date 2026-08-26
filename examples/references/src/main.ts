// Objects that hold other objects, which is where a store has to give up a
// reference as well as take one. A field is a slot with an owner: writing it
// takes a reference to what goes in and drops the one to what comes out, and
// the second half is the one that is easy to forget because forgetting it only
// leaks.

class Cell {
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

class Box {
  cell: Cell;

  constructor(cell: Cell) {
    this.cell = cell;
  }

  read(): number {
    return this.cell.value;
  }
}

// The box is built here, so the caller never names the `Cell` inside it. That
// is what makes the overwrite below a real test: the old cell's only reference
// is the field, and nothing else will release it.
function makeBox(value: number): Box {
  return new Box(new Cell(value));
}

export function replace(first: number, second: number): number {
  const box = makeBox(first);
  const before = box.read();
  box.cell = new Cell(second);
  return before * 1000 + box.read();
}

// The same slot written many times over. Every write but the last drops an
// object that nothing else is holding.
export function churn(times: number): number {
  const box = makeBox(0);
  let total = 0;
  for (let i = 0; i < times; i++) {
    box.cell = new Cell(i);
    total = total + box.read();
  }
  return total;
}

// Assigning a slot to itself. The release has to come after the store, or this
// frees the object and then reads it.
export function selfAssign(value: number): number {
  const box = makeBox(value);
  box.cell = box.cell;
  return box.read();
}

// An array of references, which is the other half of the reference map: its
// elements are slots with an owner exactly as a field is, and when the array
// stops existing every one of them has to be given up. The boxes hold cells, so
// dropping the array has to reach two levels down.
export function nested(count: number): number {
  const boxes = [makeBox(1), makeBox(2), makeBox(3)];
  let total = 0;
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < boxes.length; i++) {
      total = total + boxes[i]!.read();
    }
  }
  return total;
}

// The box never leaves this function, so it does not need to be on the heap --
// but it holds a cell that does, and that cell has to be given up where the box
// ends. A frame slot has no count to reach zero and no destructor to run, so
// the release is the compiler's to emit.
export function localBox(times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) {
    const box = new Box(new Cell(i));
    total = total + box.read();
  }
  return total;
}
