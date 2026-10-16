// A boundary test that bought nothing is taken back, and leaves nothing behind.
//
// `hir::guards` gives an exported function that recurses or loops a test at
// its boundary: when every float argument is a whole `int32`, call a copy whose
// parameters can be integers. Whether that bought anything is only known once
// the copy is analysed, and `guards::retract` takes back a test whose copy
// came out no narrower -- here, because `halves` hands itself `c + 0.5`. It
// rewired the entry past the test and left the test's blocks, and the fast
// path's call to the copy, unreachable. The verifier refused the program,
// `Unreachable { func: "halves", block: BlockId(4) }`, and `emit-c` wrote
// nothing from it.
//
// The control, `a-boundary-test-that-bought-a-whole-number`, steps by one: its
// copy narrows, the test stays, and it compiled already.
//
// The bounds keep every seed `nts check` passes -- NaN and the infinities
// among them -- to a few dozen calls.

export function halves(c: number): number {
  if (!(c > -8 && c < 7)) {
    return c;
  }
  return halves(c + 0.5);
}
