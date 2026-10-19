/*---
description: A generator method on a class yields from the instance's state.
features: [ts-iteration, ts-generators, ts-class]
---*/
class Matrix {
  constructor(private rows: number[][]) {}
  *cells(): Generator<[row: number, column: number, value: number]> {
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.rows[r].length; c++) yield [r, c, this.rows[r][c]];
    }
  }
}
const matrix = new Matrix([[1, 2], [3]]);
const labels = [...matrix.cells()].map(([r, c, v]) => `${r}${c}=${v}`);
assert.compareArray(labels, ["00=1", "01=2", "10=3"]);
