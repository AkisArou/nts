// A field read behind a non-null assertion, the way `awfy-queens` reads its
// boards: `this.cells![i]` is a load, a null test, and on the null side a
// TypeError whose message a runtime helper writes.
//
// Nothing on the path the program takes can overwrite `cells` while the read
// borrows it, and `this` is the caller's for the length of the call, so the
// load needs no count. Two things ended that borrow for the whole function:
// the message helper (`nts_access_key_description`), a call the borrow could
// not see into, and operations earlier passes had cut out of every block but
// left in the value arena, read as calls although they never run.
//
// `check` reads the board a different way at every step and keeps the same
// shape -- a method on an object the caller holds -- because the borrow is a
// parameter's field.

class Board {
  cells: boolean[] | null;
  rows: number[] | null;
  constructor(size: number) {
    this.cells = new Array(size).fill(true);
    this.rows = new Array(size).fill(-1);
  }
  free(i: number): boolean {
    return this.cells![i];
  }
  check(i: number): boolean {
    return this.free(i) && this.rows![i] < 0;
  }
}

export function work(n: number): number {
  const board = new Board(8);
  let count = 0;
  for (let i = 0; i < 64 + (n & 7); i = i + 1) {
    if (board.check(i & 7)) {
      count = count + 1;
    }
  }
  return count;
}
