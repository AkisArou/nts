// A symbol key against a plain field, in one loop, on one object.
//
// `typescript.md` claims `[kRefed]` "costs exactly what `_refed` would". This
// row is that claim as a number. The two halves do identical work through the
// two spellings, so the comparison is not against C++ or node but *within the
// row*: if a symbol key were a property map rather than a field, this would
// separate.
//
// It is also the only benchmark where node is expected to be slower for a
// reason that is not about us: V8 stores symbol-keyed properties out of the
// object's shape, and we store them in it.
const kCount = Symbol("count");
const kFlag = Symbol("flag");

class Cell {
  [kCount]: number;
  [kFlag]: boolean;
  plainCount: number;
  plainFlag: boolean;

  constructor(start: number) {
    this[kCount] = start;
    this[kFlag] = false;
    this.plainCount = start;
    this.plainFlag = false;
  }
}

export function keys(seed: number): number {
  const cell = new Cell(seed | 0);
  let total = 0;
  // The trip count carries the seed, so the loop has no closed form for the
  // C compiler to find. Written as a constant 512 first, and it folded to
  // 1.3ns against node's 325 -- a row measuring constant folding.
  const rounds = 509 + (seed | 0);
  for (let round = 0; round < rounds; round++) {
    // A dependent chain rather than a running sum: a sum has a closed form and
    // clang finds it, which is how this row first measured 1.9ns against
    // node's 325.
    cell[kCount] = ((cell[kCount] * 31) ^ round) | 0;
    cell[kFlag] = !cell[kFlag];
    cell.plainCount = ((cell.plainCount * 31) ^ round) | 0;
    cell.plainFlag = !cell.plainFlag;
    total = (total ^ cell[kCount] ^ cell.plainCount) | 0;
  }
  return total + (cell[kFlag] ? 1 : 0) + (cell.plainFlag ? 2 : 0);
}
