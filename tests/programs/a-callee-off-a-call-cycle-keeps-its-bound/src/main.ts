// Two facts that kept `awfy-queens`' board reads bounds-checked, each beside
// a control that differs in one thing.
//
// A field null-tested before it is indexed keeps its recorded length: an
// identity test hands the array to nobody. `Board#free` reads through
// `this.cells!`; `LentBoard#free` also hands the array to a call, which is
// somewhere its length could change, so the length goes.
//
// A parameter of a function no call cycle reaches follows its callers exactly
// and keeps their bound; only a parameter on a cycle widens. `place` recurses
// and its `c` settles in [0, 7] beside the `c >= 8` it is tested against.
// `at` is called with that `c` and compares it with nothing; widened with
// `place` it jumped to the i32 limit, `c + r` took an i64, and the read kept
// its check. `atOnACycle` calls itself, so its `c` widens.
//
// Each class names its field differently: classes of one shape share a layout
// (structural typing), and a fact about one field would then be all three's.

class Board {
  cells: boolean[] | null;
  constructor() {
    this.cells = new Array(8).fill(true);
  }
  free(i: number): boolean {
    return this.cells![i];
  }
}

function lend(xs: boolean[]): number {
  return xs.length;
}

class LentBoard {
  lent: boolean[] | null;
  constructor() {
    this.lent = new Array(8).fill(true);
  }
  free(i: number): boolean {
    lend(this.lent!);
    return this.lent![i];
  }
}

export function readBoard(n: number): number {
  const board = new Board();
  let count = 0;
  for (let i = 0; i < 8; i = i + 1) {
    if (board.free(i)) {
      count = count + 1;
    }
  }
  return count + (n & 1);
}

export function readLentBoard(n: number): number {
  const board = new LentBoard();
  let count = 0;
  for (let i = 0; i < 8; i = i + 1) {
    if (board.free(i)) {
      count = count + 1;
    }
  }
  return count + (n & 1);
}

class Grid {
  squares: boolean[] | null;
  constructor() {
    this.squares = new Array(16).fill(true);
  }
  at(r: number, c: number): boolean {
    return this.squares![c + r];
  }
  atOnACycle(r: number, c: number): boolean {
    if (r < 0) {
      return this.atOnACycle(r + 1, c);
    }
    return this.squares![c + r];
  }
  place(c: number): number {
    if (c >= 8) {
      return 1;
    }
    let found = 0;
    for (let r = 0; r < 8; r = r + 1) {
      if (this.at(r, c) && this.atOnACycle(r, c)) {
        found = found + 1;
      }
    }
    return found + this.place(c + 1);
  }
}

export function placeAll(n: number): number {
  return new Grid().place(n & 1);
}

// expect-ir: all: no array.get.checked in Board#free
// expect-ir: all: count array.get.checked in LentBoard#free >= 1
// expect-ir: all: no array.get.checked in Grid#at
// expect-ir: all: count array.get.checked in Grid#atOnACycle >= 1
